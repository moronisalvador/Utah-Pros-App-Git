/**
 * ════════════════════════════════════════════════
 * FILE: NativeCameraExperience.swift
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The camera screen that opens when a tech taps any photo button in the
 *   iPhone app. It works like WhatsApp's in-chat camera: a full-screen live
 *   viewfinder with a shutter button, flash and camera-flip controls, a
 *   horizontally scrolling strip of the phone's most recent photos, and an
 *   album icon that opens Apple's multi-select photo picker. Every shutter
 *   tap captures and hands the photo over IMMEDIATELY while the camera
 *   stays open ("shoot & save instantly" — owner choice 2026-08-14), with a
 *   running "N captured" counter; recent photos and album picks can be
 *   selected in a batch. There is never a "camera or album?" question —
 *   the camera IS the screen, and the album lives inside it.
 *
 * Exports (to JS via Capacitor):
 *   NativeCameraExperience.capture({ allowMultiple? })
 *     → emits a "photoCaptured" event ({ webPath, format }) per shutter tap,
 *       the moment each capture is ready — the camera stays open;
 *     → resolves { photos: [{ webPath, format }] } with the strip/album
 *       selection when one is confirmed (empty when the tech closes after
 *       shooting — those photos already streamed as events);
 *     → rejects with a message containing "cancel" ONLY when the tech
 *       closes having captured and selected nothing.
 *   (A later WhatsApp-style review tray would reuse the existing confirm-bar
 *   path: accumulate capture URLs and finish() them instead of streaming.)
 *
 * DEPENDS ON:
 *   Packages:  Capacitor (bridge), UIKit, AVFoundation, Photos, PhotosUI
 *   Internal:  registered by AppViewController.capacitorDidLoad();
 *              JS side: src/lib/nativeCamera.js (openNativeCameraExperience)
 *   Data:      reads  → device camera, photo library (strip + picker)
 *              writes → JPEG temp files under NSTemporaryDirectory() only
 *
 * NOTES / GOTCHAS:
 *   - Presented .overFullScreen, NEVER .fullScreen — fullScreen unmounts the
 *     WKWebView underneath and fires visibilitychange:hidden into the SPA
 *     (motion-standard.md §6 trap, sim-reproduced on the photo viewer).
 *   - The recents strip needs photo-library permission; if denied the strip
 *     simply hides — the PHPicker album path needs NO permission and always
 *     works. Camera denial shows an inline "enable access" state with an
 *     Open Settings button; the strip and album stay usable (that state is
 *     also what the camera-less simulator shows).
 *   - Every exported photo is re-rendered orientation-up and JPEG-encoded in
 *     Swift, so the web upload pipeline never sees HEIC or a rotated EXIF
 *     original (WKWebView HEIC decode is not dependable across iOS versions).
 *   - Zoom: the back camera opens the phone's virtual multi-lens device
 *     (triple → dual-wide → dual → wide fallback), so lens buttons and
 *     pinch-to-zoom switch physical lenses automatically as videoZoomFactor
 *     crosses the device-reported switch-over factors. The buttons are derived
 *     from the hardware (virtualDeviceSwitchOverVideoZoomFactors) — never a
 *     per-model table. The front camera stays fixed at 1×.
 *   - The Capacitor call resolves/rejects exactly once, guarded by `finished`.
 * ════════════════════════════════════════════════
 */
import UIKit
import AVFoundation
import Photos
import PhotosUI
import Capacitor

// The web --accent token (#2563eb) — hand-mirrored because no CSS↔Swift token
// bridge exists yet; if --accent is ever re-toned, update this one constant.
private let uprAccentColor = UIColor(red: 0.145, green: 0.388, blue: 0.922, alpha: 1)

// ─── SECTION: Recents-strip cell ────────────────────────────────────────────
final class RecentPhotoCell: UICollectionViewCell {
    static let reuseId = "RecentPhotoCell"
    let imageView = UIImageView()
    private let badge = UILabel()
    private let dim = UIView()
    var assetIdentifier: String?

    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.layer.cornerRadius = 8
        contentView.clipsToBounds = true
        imageView.contentMode = .scaleAspectFill
        imageView.frame = contentView.bounds
        imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        contentView.addSubview(imageView)

        dim.backgroundColor = UIColor(white: 1, alpha: 0.35)
        dim.frame = contentView.bounds
        dim.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        dim.isHidden = true
        contentView.addSubview(dim)

        badge.font = .systemFont(ofSize: 12, weight: .bold)
        badge.textColor = .white
        badge.textAlignment = .center
        badge.backgroundColor = uprAccentColor
        badge.layer.cornerRadius = 11
        badge.layer.masksToBounds = true
        badge.layer.borderColor = UIColor.white.cgColor
        badge.layer.borderWidth = 1.5
        badge.frame = CGRect(x: contentView.bounds.width - 26, y: 4, width: 22, height: 22)
        badge.autoresizingMask = [.flexibleLeftMargin, .flexibleBottomMargin]
        badge.isHidden = true
        contentView.addSubview(badge)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func prepareForReuse() {
        super.prepareForReuse()
        imageView.image = nil
        assetIdentifier = nil
        setSelection(number: nil)
    }

    /// number = 1-based position in the selection order, nil = unselected.
    func setSelection(number: Int?) {
        if let number {
            badge.text = "\(number)"
            badge.isHidden = false
            dim.isHidden = false
            contentView.layer.borderColor = uprAccentColor.cgColor
            contentView.layer.borderWidth = 2.5
            // VoiceOver: the numbered badge is visual-only — say the state.
            accessibilityValue = "selected, position \(number)"
        } else {
            badge.isHidden = true
            dim.isHidden = true
            contentView.layer.borderWidth = 0
            accessibilityValue = "not selected"
        }
    }
}

// ─── SECTION: The camera experience screen ──────────────────────────────────
final class CameraExperienceVC: UIViewController {
    private let allowMultiple: Bool
    var onFinish: (([URL]) -> Void)?
    var onCancel: (() -> Void)?
    /// Fired per shutter capture, the moment the JPEG is on disk — the JS
    /// side uploads it in the background while the camera stays open.
    var onPhotoCaptured: ((URL) -> Void)?

    // Capture
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "com.utahpros.camera.session")
    private let photoOutput = AVCapturePhotoOutput()
    private var videoInput: AVCaptureDeviceInput?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var usingFront = false
    private var flashMode: AVCaptureDevice.FlashMode = .auto
    private var capturing = false
    private var inFlightDelegate: PhotoCaptureDelegate?
    private var cameraConfigured = false

    // Zoom (back camera only — the front camera stays fixed at 1×).
    // Factors are raw videoZoomFactor values; displayed = factor × multiplier
    // (on a virtual device whose base lens is the ultra-wide, factor 1.0 shows
    // as "0.5×"). All derived from the active device in configureZoom(for:).
    private var zoomButtonFactors: [CGFloat] = []
    private var displayZoomMultiplier: CGFloat = 1
    private var minZoomFactor: CGFloat = 1
    private var maxZoomFactor: CGFloat = 1
    private var pinchStartZoomFactor: CGFloat = 1

    // Library strip
    private var assets: PHFetchResult<PHAsset>?
    private let thumbManager = PHCachingImageManager()
    private var selected: [PHAsset] = []

    // One-shot resolution guard
    private var finished = false
    // Shutter captures streamed to JS this session ("shoot & save instantly").
    private var capturedCount = 0
    private let tempDir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("upr-camera-\(UUID().uuidString)", isDirectory: true)
    private var tempCount = 0

    // Chrome
    private let previewContainer = UIView()
    private var collectionView: UICollectionView!
    private let shutterButton = UIButton(type: .custom)
    private let flashButton = UIButton(type: .system)
    private let flipButton = UIButton(type: .system)
    private let albumButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private let confirmButton = UIButton(type: .system)
    private let zoomContainer = UIView()
    private let zoomStack = UIStackView()
    private var zoomButtons: [UIButton] = []
    private let unavailableLabel = UILabel()
    private let settingsButton = UIButton(type: .system)
    private let busyOverlay = UIView()
    private let busySpinner = UIActivityIndicatorView(style: .large)
    private let savedWrap = UIView()
    private let savedLabel = UILabel()

    init(allowMultiple: Bool) {
        self.allowMultiple = allowMultiple
        super.init(nibName: nil, bundle: nil)
        // .overFullScreen keeps the WKWebView mounted underneath (see header).
        modalPresentationStyle = .overFullScreen
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var prefersStatusBarHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

    // ─── Lifecycle ──────────────────────────────────────────────────────────
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        buildChrome()
        requestCameraAndConfigure()
        requestLibraryAndLoadStrip()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = previewContainer.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        stopSession()
    }

    private func stopSession() {
        sessionQueue.async { [session] in
            if session.isRunning { session.stopRunning() }
        }
    }

    // ─── Chrome layout ──────────────────────────────────────────────────────
    private func buildChrome() {
        previewContainer.frame = view.bounds
        previewContainer.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(previewContainer)

        // Camera-unavailable / denied state (shows over the black preview area).
        unavailableLabel.text = "Camera unavailable"
        unavailableLabel.textColor = UIColor(white: 1, alpha: 0.75)
        unavailableLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        unavailableLabel.textAlignment = .center
        unavailableLabel.numberOfLines = 0
        unavailableLabel.translatesAutoresizingMaskIntoConstraints = false
        unavailableLabel.isHidden = true
        view.addSubview(unavailableLabel)

        settingsButton.setTitle("Open Settings", for: .normal)
        settingsButton.tintColor = .white
        settingsButton.backgroundColor = UIColor(white: 1, alpha: 0.18)
        settingsButton.layer.cornerRadius = 12
        settingsButton.contentEdgeInsets = UIEdgeInsets(top: 12, left: 20, bottom: 12, right: 20)
        settingsButton.translatesAutoresizingMaskIntoConstraints = false
        settingsButton.isHidden = true
        settingsButton.addTarget(self, action: #selector(openSettings), for: .touchUpInside)
        view.addSubview(settingsButton)

        // ✕ close — 48pt target clear of the notch.
        configureCircleButton(closeButton, systemName: "xmark", label: "Close camera")
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)

        // Flash — cycles auto → on → off.
        configureCircleButton(flashButton, systemName: "bolt.badge.a.fill", label: "Flash auto")
        flashButton.addTarget(self, action: #selector(flashTapped), for: .touchUpInside)

        // Bottom chrome: confirm bar → strip → shutter row.
        confirmButton.setTitle("", for: .normal)
        confirmButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .bold)
        confirmButton.tintColor = .white
        confirmButton.backgroundColor = uprAccentColor
        confirmButton.layer.cornerRadius = 24
        confirmButton.translatesAutoresizingMaskIntoConstraints = false
        confirmButton.isHidden = true
        confirmButton.addTarget(self, action: #selector(confirmSelection), for: .touchUpInside)
        view.addSubview(confirmButton)

        let layout = UICollectionViewFlowLayout()
        layout.scrollDirection = .horizontal
        layout.itemSize = CGSize(width: 64, height: 64)
        layout.minimumLineSpacing = 6
        layout.sectionInset = UIEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
        collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
        collectionView.backgroundColor = .clear
        collectionView.showsHorizontalScrollIndicator = false
        collectionView.register(RecentPhotoCell.self, forCellWithReuseIdentifier: RecentPhotoCell.reuseId)
        collectionView.dataSource = self
        collectionView.delegate = self
        collectionView.translatesAutoresizingMaskIntoConstraints = false
        collectionView.isHidden = true // shown once library permission lands
        view.addSubview(collectionView)

        // Shutter — 62pt white ring, the primary action.
        shutterButton.translatesAutoresizingMaskIntoConstraints = false
        shutterButton.backgroundColor = .white
        shutterButton.layer.cornerRadius = 31
        shutterButton.layer.borderColor = UIColor(white: 1, alpha: 0.4).cgColor
        shutterButton.layer.borderWidth = 5
        shutterButton.accessibilityLabel = "Take photo"
        shutterButton.addTarget(self, action: #selector(shutterTapped), for: .touchUpInside)
        view.addSubview(shutterButton)

        configureCircleButton(albumButton, systemName: "photo.on.rectangle", label: "Choose from album")
        albumButton.addTarget(self, action: #selector(albumTapped), for: .touchUpInside)

        // Lens buttons (0.5× / 1× / …) — populated from the device's own
        // switch-over factors once the session is configured; hidden until then.
        zoomContainer.backgroundColor = UIColor(white: 0, alpha: 0.25)
        zoomContainer.layer.cornerRadius = 28
        zoomContainer.translatesAutoresizingMaskIntoConstraints = false
        zoomContainer.isHidden = true
        view.addSubview(zoomContainer)
        zoomStack.axis = .horizontal
        zoomStack.spacing = 4
        zoomStack.translatesAutoresizingMaskIntoConstraints = false
        zoomContainer.addSubview(zoomStack)

        // Pinch-to-zoom on the viewfinder (previewContainer sits behind the
        // chrome, so pinches over buttons/strip don't fight their gestures).
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(pinched(_:)))
        previewContainer.addGestureRecognizer(pinch)

        configureCircleButton(flipButton, systemName: "arrow.triangle.2.circlepath.camera", label: "Switch camera")
        flipButton.addTarget(self, action: #selector(flipTapped), for: .touchUpInside)

        // "N captured" counter — feedback that each shutter tap was handed to the
        // app while the camera stays open. It counts captures, not uploads: the
        // page's uploader owns success/failure reporting, and its toasts are
        // hidden behind this full-screen camera, so this label must never claim
        // more than capture.
        savedWrap.backgroundColor = UIColor(white: 0, alpha: 0.45)
        savedWrap.layer.cornerRadius = 16
        savedWrap.translatesAutoresizingMaskIntoConstraints = false
        savedWrap.isHidden = true
        savedLabel.textColor = .white
        savedLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        savedLabel.translatesAutoresizingMaskIntoConstraints = false
        savedWrap.addSubview(savedLabel)
        view.addSubview(savedWrap)

        // Busy overlay while exporting selections (iCloud originals can take a moment).
        busyOverlay.backgroundColor = UIColor(white: 0, alpha: 0.45)
        busyOverlay.frame = view.bounds
        busyOverlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        busyOverlay.isHidden = true
        busySpinner.color = .white
        busySpinner.translatesAutoresizingMaskIntoConstraints = false
        busyOverlay.addSubview(busySpinner)
        view.addSubview(busyOverlay)

        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            closeButton.topAnchor.constraint(equalTo: safe.topAnchor, constant: 12),
            closeButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            closeButton.widthAnchor.constraint(equalToConstant: 48),
            closeButton.heightAnchor.constraint(equalToConstant: 48),

            flashButton.topAnchor.constraint(equalTo: safe.topAnchor, constant: 12),
            flashButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            flashButton.widthAnchor.constraint(equalToConstant: 48),
            flashButton.heightAnchor.constraint(equalToConstant: 48),

            shutterButton.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -18),
            shutterButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            shutterButton.widthAnchor.constraint(equalToConstant: 62),
            shutterButton.heightAnchor.constraint(equalToConstant: 62),

            albumButton.centerYAnchor.constraint(equalTo: shutterButton.centerYAnchor),
            albumButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
            albumButton.widthAnchor.constraint(equalToConstant: 48),
            albumButton.heightAnchor.constraint(equalToConstant: 48),

            flipButton.centerYAnchor.constraint(equalTo: shutterButton.centerYAnchor),
            flipButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
            flipButton.widthAnchor.constraint(equalToConstant: 48),
            flipButton.heightAnchor.constraint(equalToConstant: 48),

            collectionView.bottomAnchor.constraint(equalTo: shutterButton.topAnchor, constant: -14),
            collectionView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collectionView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            collectionView.heightAnchor.constraint(equalToConstant: 64),

            zoomContainer.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            zoomContainer.bottomAnchor.constraint(equalTo: collectionView.topAnchor, constant: -12),
            zoomContainer.heightAnchor.constraint(equalToConstant: 56),

            zoomStack.topAnchor.constraint(equalTo: zoomContainer.topAnchor, constant: 4),
            zoomStack.bottomAnchor.constraint(equalTo: zoomContainer.bottomAnchor, constant: -4),
            zoomStack.leadingAnchor.constraint(equalTo: zoomContainer.leadingAnchor, constant: 4),
            zoomStack.trailingAnchor.constraint(equalTo: zoomContainer.trailingAnchor, constant: -4),

            confirmButton.bottomAnchor.constraint(equalTo: zoomContainer.topAnchor, constant: -12),
            confirmButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            confirmButton.heightAnchor.constraint(equalToConstant: 48),
            confirmButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 160),

            unavailableLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            unavailableLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -60),
            unavailableLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
            unavailableLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32),

            settingsButton.topAnchor.constraint(equalTo: unavailableLabel.bottomAnchor, constant: 16),
            settingsButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            settingsButton.heightAnchor.constraint(equalToConstant: 48),

            busySpinner.centerXAnchor.constraint(equalTo: busyOverlay.centerXAnchor),
            busySpinner.centerYAnchor.constraint(equalTo: busyOverlay.centerYAnchor),

            savedWrap.topAnchor.constraint(equalTo: safe.topAnchor, constant: 18),
            savedWrap.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            savedLabel.topAnchor.constraint(equalTo: savedWrap.topAnchor, constant: 7),
            savedLabel.bottomAnchor.constraint(equalTo: savedWrap.bottomAnchor, constant: -7),
            savedLabel.leadingAnchor.constraint(equalTo: savedWrap.leadingAnchor, constant: 14),
            savedLabel.trailingAnchor.constraint(equalTo: savedWrap.trailingAnchor, constant: -14),
        ])
    }

    private func configureCircleButton(_ button: UIButton, systemName: String, label: String) {
        button.setImage(UIImage(systemName: systemName,
                                withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold)),
                        for: .normal)
        button.tintColor = .white
        button.backgroundColor = UIColor(white: 0, alpha: 0.35)
        button.layer.cornerRadius = 24
        button.translatesAutoresizingMaskIntoConstraints = false
        button.accessibilityLabel = label
        view.addSubview(button)
    }

    private func setBusy(_ busy: Bool) {
        // The opaque overlay itself swallows touches while visible.
        busyOverlay.isHidden = !busy
        if busy { busySpinner.startAnimating() } else { busySpinner.stopAnimating() }
    }

    // ─── Camera session ─────────────────────────────────────────────────────
    private func requestCameraAndConfigure() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted { self?.configureSession() } else { self?.showCameraUnavailable(denied: true) }
                }
            }
        default:
            showCameraUnavailable(denied: true)
        }
    }

    private func showCameraUnavailable(denied: Bool) {
        unavailableLabel.text = denied
            ? "Camera access is off for UPR.\nTurn it on in Settings to take photos."
            : "Camera unavailable on this device"
        unavailableLabel.isHidden = false
        settingsButton.isHidden = !denied
        shutterButton.isEnabled = false
        shutterButton.alpha = 0.35
        flashButton.isHidden = true
        flipButton.isHidden = true
        zoomContainer.isHidden = true
    }

    private func device(front: Bool) -> AVCaptureDevice? {
        if front {
            return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
        }
        // Virtual multi-lens devices switch physical lenses automatically as
        // videoZoomFactor crosses their switch-over factors — the same
        // mechanism Apple Camera and WhatsApp ride. Most capable first; a
        // single-lens phone lands on the plain wide angle as before.
        let backTypes: [AVCaptureDevice.DeviceType] = [
            .builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera,
        ]
        for type in backTypes {
            if let device = AVCaptureDevice.default(type, for: .video, position: .back) { return device }
        }
        return nil
    }

    private func configureSession() {
        guard let camera = device(front: usingFront) else {
            showCameraUnavailable(denied: false)
            return
        }
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = previewContainer.bounds
        previewContainer.layer.addSublayer(layer)
        previewLayer = layer

        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.session.beginConfiguration()
            self.session.sessionPreset = .photo
            if let input = try? AVCaptureDeviceInput(device: camera), self.session.canAddInput(input) {
                self.session.addInput(input)
                self.videoInput = input
            }
            if self.session.canAddOutput(self.photoOutput) {
                self.session.addOutput(self.photoOutput)
            }
            self.session.commitConfiguration()
            self.configureZoom(for: camera, front: self.usingFront)
            self.session.startRunning()
            DispatchQueue.main.async {
                self.cameraConfigured = true
                self.updateFlashButton()
            }
        }
    }

    private func updateFlashButton() {
        let hasFlash = videoInput?.device.isFlashAvailable ?? false
        flashButton.isHidden = !hasFlash || !cameraConfigured
        let (icon, label): (String, String)
        switch flashMode {
        case .on: (icon, label) = ("bolt.fill", "Flash on")
        case .off: (icon, label) = ("bolt.slash.fill", "Flash off")
        default: (icon, label) = ("bolt.badge.a.fill", "Flash auto")
        }
        flashButton.setImage(UIImage(systemName: icon,
                                     withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold)),
                             for: .normal)
        flashButton.accessibilityLabel = label
    }

    @objc private func flashTapped() {
        switch flashMode {
        case .auto: flashMode = .on
        case .on: flashMode = .off
        default: flashMode = .auto
        }
        updateFlashButton()
    }

    @objc private func flipTapped() {
        guard cameraConfigured else { return }
        usingFront.toggle()
        guard let camera = device(front: usingFront) else { usingFront.toggle(); return }
        let front = usingFront
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.session.beginConfiguration()
            if let current = self.videoInput { self.session.removeInput(current) }
            if let input = try? AVCaptureDeviceInput(device: camera), self.session.canAddInput(input) {
                self.session.addInput(input)
                self.videoInput = input
            }
            self.session.commitConfiguration()
            self.configureZoom(for: camera, front: front)
            DispatchQueue.main.async { self.updateFlashButton() }
        }
    }

    @objc private func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    // ─── Zoom ───────────────────────────────────────────────────────────────
    /// Reads the zoom geometry off the active device and normalizes the start
    /// zoom to the wide lens. A virtual device whose base lens is the
    /// ultra-wide otherwise opens at factor 1.0 — the 0.5× field of view —
    /// which would silently change what a photo button captures.
    /// Runs on sessionQueue; publishes the derived buttons to main.
    private func configureZoom(for device: AVCaptureDevice, front: Bool) {
        if front {
            DispatchQueue.main.async { [weak self] in self?.zoomContainer.isHidden = true }
            return
        }
        let switchOvers = device.virtualDeviceSwitchOverVideoZoomFactors.map { CGFloat(truncating: $0) }
        let hasUltraWide = device.constituentDevices.contains { $0.deviceType == .builtInUltraWideCamera }
        // Displayed zoom = videoZoomFactor × multiplier. With an ultra-wide
        // base lens the first switch-over IS the displayed 1×, so the
        // multiplier is its reciprocal; single-lens and wide-based devices
        // display the raw factor. iOS 18+ reports the multiplier directly.
        var multiplier: CGFloat = hasUltraWide ? 1 / (switchOvers.first ?? 2) : 1
        if #available(iOS 18.0, *) {
            multiplier = device.displayVideoZoomFactorMultiplier
        }
        if multiplier <= 0 { multiplier = 1 }
        // The factor that displays as 1× — the wide lens — is where the
        // camera must open (camera-first doctrine: what you see is 1×).
        let wideFactor: CGFloat = 1 / multiplier
        let minFactor = device.minAvailableVideoZoomFactor
        // Past the last lens everything is digital crop; the sensor advertises
        // 100×+ of mush, so cap the pinch at a displayed 10×.
        let maxFactor = min(device.maxAvailableVideoZoomFactor, 10 / multiplier)
        let factors = ([minFactor] + switchOvers).filter { $0 >= minFactor && $0 <= maxFactor }
        do {
            try device.lockForConfiguration()
            device.videoZoomFactor = min(max(wideFactor, minFactor), maxFactor)
            device.unlockForConfiguration()
        } catch {}
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.displayZoomMultiplier = multiplier
            self.minZoomFactor = minFactor
            self.maxZoomFactor = maxFactor
            self.zoomButtonFactors = factors
            self.rebuildZoomButtons()
            self.updateZoomSelection(currentFactor: wideFactor)
            // A single-lens phone gets no buttons (nothing to switch to) but
            // keeps pinch digital zoom on the viewfinder.
            self.zoomContainer.isHidden = factors.count < 2
        }
    }

    private func rebuildZoomButtons() {
        zoomButtons.forEach { $0.removeFromSuperview() }
        zoomButtons = []
        for (index, factor) in zoomButtonFactors.enumerated() {
            let button = UIButton(type: .custom)
            button.tag = index
            button.titleLabel?.font = .monospacedDigitSystemFont(ofSize: 12, weight: .semibold)
            button.setTitleColor(.white, for: .normal)
            button.backgroundColor = UIColor(white: 0, alpha: 0.35)
            button.layer.cornerRadius = 24
            button.translatesAutoresizingMaskIntoConstraints = false
            // 48pt targets — the same floor every other control on this screen
            // keeps (gloved field-tech hands; UPR-Design-System touch law).
            button.widthAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
            button.heightAnchor.constraint(equalToConstant: 48).isActive = true
            button.accessibilityLabel = "Zoom \(Self.zoomText(factor * displayZoomMultiplier, suffix: "x"))"
            button.addTarget(self, action: #selector(zoomButtonTapped(_:)), for: .touchUpInside)
            zoomStack.addArrangedSubview(button)
            zoomButtons.append(button)
        }
    }

    /// Highlights the lens the current factor rides on; the active button
    /// carries the live displayed value while pinching ("1.7×").
    private func updateZoomSelection(currentFactor: CGFloat) {
        var activeIndex = 0
        for (index, factor) in zoomButtonFactors.enumerated() where currentFactor >= factor - 0.02 {
            activeIndex = index
        }
        for (index, button) in zoomButtons.enumerated() {
            let isActive = index == activeIndex
            let shown = isActive ? currentFactor : zoomButtonFactors[index]
            button.setTitle(Self.zoomText(shown * displayZoomMultiplier, suffix: "×"), for: .normal)
            button.backgroundColor = UIColor(white: 0, alpha: isActive ? 0.6 : 0.35)
            button.titleLabel?.font = .monospacedDigitSystemFont(ofSize: 12, weight: isActive ? .bold : .semibold)
        }
    }

    /// "0.5×", "1×", "1.7×" — one decimal between lens stops, none on them.
    private static func zoomText(_ displayed: CGFloat, suffix: String) -> String {
        let rounded = (displayed * 10).rounded() / 10
        if abs(rounded - rounded.rounded()) < 0.001 { return "\(Int(rounded.rounded()))\(suffix)" }
        return String(format: "%.1f%@", rounded, suffix)
    }

    @objc private func zoomButtonTapped(_ sender: UIButton) {
        guard sender.tag < zoomButtonFactors.count else { return }
        setZoom(zoomButtonFactors[sender.tag], animated: true)
    }

    private func setZoom(_ factor: CGFloat, animated: Bool) {
        // videoZoomFactor throws NSRangeException out of range — clamp always.
        let clamped = min(max(factor, minZoomFactor), maxZoomFactor)
        sessionQueue.async { [weak self] in
            guard let self, let device = self.videoInput?.device, device.position == .back else { return }
            do {
                try device.lockForConfiguration()
                if animated {
                    // Rate is in factor-doublings/second: one lens stop ≈ 0.2s.
                    device.ramp(toVideoZoomFactor: clamped, withRate: 6)
                } else {
                    device.videoZoomFactor = clamped
                }
                device.unlockForConfiguration()
            } catch {}
        }
        updateZoomSelection(currentFactor: clamped)
    }

    @objc private func pinched(_ gesture: UIPinchGestureRecognizer) {
        guard cameraConfigured, !usingFront, !finished,
              let device = videoInput?.device, device.position == .back else { return }
        switch gesture.state {
        case .began:
            pinchStartZoomFactor = device.videoZoomFactor
        case .changed:
            setZoom(pinchStartZoomFactor * gesture.scale, animated: false)
        default:
            break
        }
    }

    // ─── Shutter ────────────────────────────────────────────────────────────
    @objc private func shutterTapped() {
        guard cameraConfigured, videoInput != nil, !capturing, !finished else { return }
        capturing = true
        let settings: AVCapturePhotoSettings
        if photoOutput.availablePhotoCodecTypes.contains(.jpeg) {
            settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
        } else {
            settings = AVCapturePhotoSettings()
        }
        if videoInput?.device.isFlashAvailable == true { settings.flashMode = flashMode }
        let delegate = PhotoCaptureDelegate { [weak self] data in
            DispatchQueue.main.async {
                guard let self else { return }
                self.capturing = false
                self.inFlightDelegate = nil
                guard let data, let image = UIImage(data: data),
                      let jpeg = Self.normalizedJPEG(image),
                      let url = self.writeTemp(jpeg) else { return }
                // Shoot & save instantly (owner choice 2026-08-14): the photo
                // streams to JS NOW — upload starts in the background — and
                // the camera stays open so the tech can keep shooting.
                self.capturedCount += 1
                // "captured", deliberately NOT "saved": this fires before JS has
                // even received the photo, and the page's uploader reports its own
                // success/failure by toast — which this full-screen camera covers.
                // Claiming "saved" here told a tech their evidence was persisted
                // when the upload may have failed (PR #654 review, P1). The
                // upload-acknowledgement round-trip that could honestly say
                // "saved" is a designed follow-up, not this label's job.
                self.savedLabel.text = self.capturedCount == 1 ? "1 captured" : "\(self.capturedCount) captured"
                self.savedWrap.isHidden = false
                self.savedWrap.accessibilityLabel = "\(self.capturedCount) photo\(self.capturedCount == 1 ? "" : "s") captured"
                UIAccessibility.post(notification: .announcement, argument: self.savedWrap.accessibilityLabel)
                self.onPhotoCaptured?(url)
            }
        }
        inFlightDelegate = delegate
        photoOutput.capturePhoto(with: settings, delegate: delegate)
    }

    // ─── Recents strip ──────────────────────────────────────────────────────
    private func requestLibraryAndLoadStrip() {
        let current = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        switch current {
        case .authorized, .limited:
            loadStrip()
        case .notDetermined:
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { [weak self] status in
                DispatchQueue.main.async {
                    if status == .authorized || status == .limited { self?.loadStrip() }
                }
            }
        default:
            break // strip stays hidden; the album picker still works
        }
    }

    private func loadStrip() {
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.fetchLimit = 60
        assets = PHAsset.fetchAssets(with: .image, options: options)
        collectionView.isHidden = (assets?.count ?? 0) == 0
        collectionView.reloadData()
    }

    private func updateConfirmButton() {
        guard allowMultiple else { return }
        if selected.isEmpty {
            confirmButton.isHidden = true
        } else {
            confirmButton.isHidden = false
            let n = selected.count
            confirmButton.setTitle(n == 1 ? "  Add 1 photo  " : "  Add \(n) photos  ", for: .normal)
            confirmButton.accessibilityLabel = "Add \(n) selected photo\(n == 1 ? "" : "s")"
        }
    }

    @objc private func confirmSelection() {
        guard !selected.isEmpty, !finished else { return }
        exportAssets(selected)
    }

    private func exportAssets(_ assetsToExport: [PHAsset]) {
        setBusy(true)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            var urls: [URL] = []
            let options = PHImageRequestOptions()
            options.deliveryMode = .highQualityFormat
            options.isSynchronous = true
            options.isNetworkAccessAllowed = true // iCloud-optimized originals
            for asset in assetsToExport {
                autoreleasepool {
                    var image: UIImage?
                    PHImageManager.default().requestImage(
                        for: asset,
                        targetSize: PHImageManagerMaximumSize,
                        contentMode: .aspectFit,
                        options: options
                    ) { img, _ in image = img }
                    if let img = image, let jpeg = Self.normalizedJPEG(img), let url = self.writeTemp(jpeg) {
                        urls.append(url)
                    }
                }
            }
            DispatchQueue.main.async {
                self.setBusy(false)
                if urls.isEmpty {
                    // Nothing exportable (e.g. iCloud fetch failed offline) —
                    // stay on the camera rather than resolving empty.
                    self.selected = []
                    self.collectionView.reloadData()
                    self.updateConfirmButton()
                } else {
                    self.finish(urls)
                }
            }
        }
    }

    // ─── Album picker (PHPicker — no permission needed) ─────────────────────
    @objc private func albumTapped() {
        guard !finished else { return }
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.filter = .images
        config.selectionLimit = allowMultiple ? 0 : 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        present(picker, animated: true)
    }

    // ─── Temp files + finish ────────────────────────────────────────────────
    private func writeTemp(_ data: Data) -> URL? {
        let fm = FileManager.default
        if !fm.fileExists(atPath: tempDir.path) {
            try? fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        }
        tempCount += 1
        let url = tempDir.appendingPathComponent("photo-\(tempCount).jpg")
        guard (try? data.write(to: url, options: .atomic)) != nil else { return nil }
        return url
    }

    /// Re-render orientation-up and encode JPEG so the web pipeline never sees
    /// HEIC or relies on EXIF rotation handling.
    static func normalizedJPEG(_ image: UIImage, quality: CGFloat = 0.85) -> Data? {
        if image.imageOrientation == .up { return image.jpegData(compressionQuality: quality) }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
        let redrawn = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: image.size))
        }
        return redrawn.jpegData(compressionQuality: quality)
    }

    private func finish(_ urls: [URL]) {
        guard !finished else { return }
        finished = true
        stopSession()
        dismiss(animated: true) { [onFinish] in onFinish?(urls) }
    }

    @objc private func closeTapped() {
        guard !finished else { return }
        // After shooting, ✕ means "done", not "cancel" — the captured photos
        // already streamed to JS, so resolve empty rather than rejecting.
        if capturedCount > 0 {
            finish([])
            return
        }
        finished = true
        stopSession()
        dismiss(animated: true) { [onCancel] in onCancel?() }
    }
}

// ─── SECTION: Strip data source / selection ─────────────────────────────────
extension CameraExperienceVC: UICollectionViewDataSource, UICollectionViewDelegate {
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
        assets?.count ?? 0
    }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: RecentPhotoCell.reuseId, for: indexPath) as! RecentPhotoCell
        guard let asset = assets?.object(at: indexPath.item) else { return cell }
        cell.assetIdentifier = asset.localIdentifier
        let scale = UIScreen.main.scale
        let size = CGSize(width: 64 * scale, height: 64 * scale)
        thumbManager.requestImage(for: asset, targetSize: size, contentMode: .aspectFill, options: nil) { image, _ in
            // Cells recycle while thumbnails stream in — only stamp the match.
            if cell.assetIdentifier == asset.localIdentifier { cell.imageView.image = image }
        }
        if allowMultiple, let pos = selected.firstIndex(where: { $0.localIdentifier == asset.localIdentifier }) {
            cell.setSelection(number: pos + 1)
        } else {
            cell.setSelection(number: nil)
        }
        cell.isAccessibilityElement = true
        cell.accessibilityLabel = "Recent photo"
        return cell
    }

    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        guard let asset = assets?.object(at: indexPath.item), !finished else { return }
        if !allowMultiple {
            // Single-shot surface: tapping a recent photo returns it directly.
            exportAssets([asset])
            return
        }
        if let pos = selected.firstIndex(where: { $0.localIdentifier == asset.localIdentifier }) {
            selected.remove(at: pos)
        } else {
            selected.append(asset)
        }
        // Renumber every visible badge (removal shifts later positions).
        collectionView.reloadData()
        updateConfirmButton()
    }
}

// ─── SECTION: PHPicker delegate ─────────────────────────────────────────────
extension CameraExperienceVC: PHPickerViewControllerDelegate {
    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        // Picker cancel returns to the camera — the tech can still shoot or ✕.
        guard !results.isEmpty, !finished else { return }
        setBusy(true)
        let providers = results.map(\.itemProvider)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            var ordered: [URL?] = Array(repeating: nil, count: providers.count)
            let lock = NSLock()
            let group = DispatchGroup()
            for (index, provider) in providers.enumerated() where provider.canLoadObject(ofClass: UIImage.self) {
                group.enter()
                provider.loadObject(ofClass: UIImage.self) { object, _ in
                    defer { group.leave() }
                    guard let image = object as? UIImage,
                          let jpeg = Self.normalizedJPEG(image) else { return }
                    lock.lock()
                    let url = self.writeTemp(jpeg)
                    ordered[index] = url
                    lock.unlock()
                }
            }
            group.wait()
            let urls = ordered.compactMap { $0 }
            DispatchQueue.main.async {
                self.setBusy(false)
                if !urls.isEmpty { self.finish(urls) }
            }
        }
    }
}

// ─── SECTION: Photo capture delegate (retained per shot) ────────────────────
final class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    private let completion: (Data?) -> Void
    init(completion: @escaping (Data?) -> Void) {
        self.completion = completion
    }

    func photoOutput(_ output: AVCapturePhotoOutput,
                     didFinishProcessingPhoto photo: AVCapturePhoto,
                     error: Error?) {
        completion(error == nil ? photo.fileDataRepresentation() : nil)
    }
}

// ─── SECTION: Capacitor plugin ──────────────────────────────────────────────
@objc(NativeCameraExperiencePlugin)
public class NativeCameraExperiencePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeCameraExperiencePlugin"
    public let jsName = "NativeCameraExperience"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capture", returnType: CAPPluginReturnPromise),
    ]

    @objc func capture(_ call: CAPPluginCall) {
        let allowMultiple = call.getBool("allowMultiple") ?? false
        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                call.reject("no presenting view controller")
                return
            }
            let vc = CameraExperienceVC(allowMultiple: allowMultiple)
            // Shoot & save instantly: each shutter capture streams to JS the
            // moment its JPEG is ready, while the camera stays open.
            vc.onPhotoCaptured = { [weak self] url in
                guard let self, let portable = self.bridge?.portablePath(fromLocalURL: url) else { return }
                self.notifyListeners("photoCaptured", data: [
                    "webPath": portable.absoluteString,
                    "format": "jpeg",
                ])
            }
            vc.onFinish = { [weak self] urls in
                let photos: [[String: String]] = urls.compactMap { url in
                    guard let portable = self?.bridge?.portablePath(fromLocalURL: url) else { return nil }
                    return ["webPath": portable.absoluteString, "format": "jpeg"]
                }
                call.resolve(["photos": photos])
            }
            // isUserCancelled() on the JS side keys on "cancel" — keep it.
            // Only fires when NOTHING was captured or selected (the VC turns
            // ✕-after-shooting into an empty resolve instead).
            vc.onCancel = { call.reject("User cancelled photos app") }
            presenter.present(vc, animated: true)
        }
    }
}
