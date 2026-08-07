/**
 * ════════════════════════════════════════════════
 * FILE: NativePhotoViewer.swift
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The native photo viewer for the iOS app. When a tech taps a photo in a
 *   conversation or album, this opens Apple's own full-screen viewer: swipe
 *   between photos, pinch to zoom, double-tap to zoom, drag to pan — all
 *   with the exact system physics the Photos app has, because the zooming
 *   IS a UIScrollView. The web app keeps its JavaScript viewer; this one
 *   only exists inside the installed iPhone app.
 *
 * Exports (to JS via Capacitor):
 *   NativePhotoViewer.present({ urls, captions?, startIndex? })
 *     → resolves when the viewer is closed (the ✕ button).
 *
 * DEPENDS ON:
 *   Packages:  Capacitor (bridge), UIKit
 *   Internal:  registered by AppViewController.capacitorDidLoad()
 *   Data:      reads  → the image URLs it is handed (signed/public HTTPS)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The JS side (src/lib/nativePhotoViewer.js + tech/Lightbox.jsx) feature-
 *     detects this plugin, so an older installed binary without it falls
 *     back to the web lightbox gracefully.
 *   - Images load with URLSession per page (current page only — pages are
 *     created lazily by UIPageViewController), so a 50-photo album does not
 *     fetch 50 originals.
 *   - The pager resolves its Capacitor call exactly once, on dismiss.
 * ════════════════════════════════════════════════
 */
import UIKit
import Capacitor

// ─── SECTION: One zoomable page (UIScrollView owns ALL gesture physics) ─────
final class ZoomableImagePage: UIViewController, UIScrollViewDelegate {
    let pageIndex: Int
    private let url: URL
    private let scrollView = UIScrollView()
    private let imageView = UIImageView()
    private let spinner = UIActivityIndicatorView(style: .large)
    private var task: URLSessionDataTask?

    init(url: URL, pageIndex: Int) {
        self.url = url
        self.pageIndex = pageIndex
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        scrollView.frame = view.bounds
        scrollView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        scrollView.delegate = self
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 4
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.contentInsetAdjustmentBehavior = .never
        view.addSubview(scrollView)

        imageView.contentMode = .scaleAspectFit
        scrollView.addSubview(imageView)

        spinner.color = .white
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
        spinner.startAnimating()

        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(onDoubleTap(_:)))
        doubleTap.numberOfTapsRequired = 2
        scrollView.addGestureRecognizer(doubleTap)

        load()
    }

    deinit { task?.cancel() }

    private func load() {
        task = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                self.spinner.stopAnimating()
                guard let data, let image = UIImage(data: data) else { return }
                self.imageView.image = image
                self.layoutImage()
            }
        }
        task?.resume()
    }

    // Fit the image at zoom 1; UIScrollView scales from there.
    private func layoutImage() {
        guard let image = imageView.image else { return }
        let bounds = scrollView.bounds.size
        guard bounds.width > 0, bounds.height > 0 else { return }
        let scale = min(bounds.width / image.size.width, bounds.height / image.size.height)
        let fit = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        scrollView.zoomScale = 1
        imageView.frame = CGRect(origin: .zero, size: fit)
        scrollView.contentSize = fit
        centerContent()
    }

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        // Rotation/resize: re-fit when unzoomed, otherwise keep centering sane.
        if scrollView.zoomScale <= 1.01 { layoutImage() } else { centerContent() }
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { centerContent() }

    // A smaller-than-viewport image centers via insets; a larger one pans
    // edge to edge. This is the canonical UIScrollView zoom-centering idiom.
    private func centerContent() {
        let b = scrollView.bounds.size
        let c = scrollView.contentSize
        let dx = max(0, (b.width - c.width) / 2)
        let dy = max(0, (b.height - c.height) / 2)
        scrollView.contentInset = UIEdgeInsets(top: dy, left: dx, bottom: dy, right: dx)
    }

    @objc private func onDoubleTap(_ gesture: UITapGestureRecognizer) {
        if scrollView.zoomScale > 1.01 {
            scrollView.setZoomScale(1, animated: true)
        } else {
            let point = gesture.location(in: imageView)
            let target: CGFloat = 2.5
            let size = CGSize(width: scrollView.bounds.width / target,
                              height: scrollView.bounds.height / target)
            let rect = CGRect(x: point.x - size.width / 2,
                              y: point.y - size.height / 2,
                              width: size.width, height: size.height)
            scrollView.zoom(to: rect, animated: true)
        }
    }
}

// ─── SECTION: Pager (swipe between photos) + chrome ─────────────────────────
final class NativePhotoPagerVC: UIPageViewController, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
    private let urls: [URL]
    private let captions: [String]
    private var currentIndex: Int
    var onDismiss: (() -> Void)?

    private let counterLabel = UILabel()
    private let captionLabel = UILabel()
    private let captionWrap = UIView()

    init(urls: [URL], captions: [String], startIndex: Int) {
        self.urls = urls
        self.captions = captions
        self.currentIndex = startIndex
        super.init(transitionStyle: .scroll,
                   navigationOrientation: .horizontal,
                   options: [.interPageSpacing: 10])
        // .overFullScreen, NOT .fullScreen: fullScreen unmounts the web view
        // underneath, which fires visibilitychange:hidden into the SPA and
        // its thread resume/lease logic closes the conversation while the
        // viewer is up. overFullScreen keeps the web view in the hierarchy.
        modalPresentationStyle = .overFullScreen
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        dataSource = self
        delegate = self
        if let first = page(at: currentIndex) {
            setViewControllers([first], direction: .forward, animated: false)
        }

        // ✕ — 48pt circle, clear of the status bar via the safe area.
        let close = UIButton(type: .system)
        close.setImage(UIImage(systemName: "xmark",
                               withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold)),
                       for: .normal)
        close.tintColor = .white
        close.backgroundColor = UIColor(white: 1, alpha: 0.18)
        close.layer.cornerRadius = 24
        close.translatesAutoresizingMaskIntoConstraints = false
        close.accessibilityLabel = "Close"
        close.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        view.addSubview(close)

        counterLabel.textColor = .white
        counterLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        let counterWrap = UIView()
        counterWrap.backgroundColor = UIColor(white: 0, alpha: 0.35)
        counterWrap.layer.cornerRadius = 14
        counterWrap.translatesAutoresizingMaskIntoConstraints = false
        counterLabel.translatesAutoresizingMaskIntoConstraints = false
        counterWrap.addSubview(counterLabel)
        view.addSubview(counterWrap)

        captionWrap.backgroundColor = UIColor(white: 0, alpha: 0.55)
        captionWrap.layer.cornerRadius = 10
        captionWrap.translatesAutoresizingMaskIntoConstraints = false
        captionLabel.textColor = .white
        captionLabel.font = .systemFont(ofSize: 13)
        captionLabel.numberOfLines = 3
        captionLabel.textAlignment = .center
        captionLabel.translatesAutoresizingMaskIntoConstraints = false
        captionWrap.addSubview(captionLabel)
        view.addSubview(captionWrap)

        NSLayoutConstraint.activate([
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            close.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            close.widthAnchor.constraint(equalToConstant: 48),
            close.heightAnchor.constraint(equalToConstant: 48),

            counterWrap.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 22),
            counterWrap.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            counterLabel.topAnchor.constraint(equalTo: counterWrap.topAnchor, constant: 6),
            counterLabel.bottomAnchor.constraint(equalTo: counterWrap.bottomAnchor, constant: -6),
            counterLabel.leadingAnchor.constraint(equalTo: counterWrap.leadingAnchor, constant: 12),
            counterLabel.trailingAnchor.constraint(equalTo: counterWrap.trailingAnchor, constant: -12),

            captionWrap.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            captionWrap.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 20),
            captionWrap.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -20),
            captionWrap.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            captionLabel.topAnchor.constraint(equalTo: captionWrap.topAnchor, constant: 8),
            captionLabel.bottomAnchor.constraint(equalTo: captionWrap.bottomAnchor, constant: -8),
            captionLabel.leadingAnchor.constraint(equalTo: captionWrap.leadingAnchor, constant: 14),
            captionLabel.trailingAnchor.constraint(equalTo: captionWrap.trailingAnchor, constant: -14),
        ])
        updateChrome()
    }

    private func page(at index: Int) -> ZoomableImagePage? {
        guard index >= 0, index < urls.count else { return nil }
        return ZoomableImagePage(url: urls[index], pageIndex: index)
    }

    private func caption(at index: Int) -> String {
        guard index >= 0, index < captions.count else { return "" }
        return captions[index]
    }

    private func updateChrome() {
        counterLabel.text = "\(currentIndex + 1) / \(urls.count)"
        let text = caption(at: currentIndex)
        captionLabel.text = text
        captionWrap.isHidden = text.isEmpty
    }

    func pageViewController(_ pageViewController: UIPageViewController,
                            viewControllerBefore viewController: UIViewController) -> UIViewController? {
        guard let current = viewController as? ZoomableImagePage else { return nil }
        return page(at: current.pageIndex - 1)
    }

    func pageViewController(_ pageViewController: UIPageViewController,
                            viewControllerAfter viewController: UIViewController) -> UIViewController? {
        guard let current = viewController as? ZoomableImagePage else { return nil }
        return page(at: current.pageIndex + 1)
    }

    func pageViewController(_ pageViewController: UIPageViewController,
                            didFinishAnimating finished: Bool,
                            previousViewControllers: [UIViewController],
                            transitionCompleted completed: Bool) {
        guard completed, let visible = viewControllers?.first as? ZoomableImagePage else { return }
        currentIndex = visible.pageIndex
        updateChrome()
    }

    @objc private func closeTapped() {
        dismiss(animated: true) { [onDismiss] in onDismiss?() }
    }
}

// ─── SECTION: Capacitor plugin ──────────────────────────────────────────────
@objc(NativePhotoViewerPlugin)
public class NativePhotoViewerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativePhotoViewerPlugin"
    public let jsName = "NativePhotoViewer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "present", returnType: CAPPluginReturnPromise),
    ]

    @objc func present(_ call: CAPPluginCall) {
        let urlStrings = call.getArray("urls", String.self) ?? []
        let urls = urlStrings.compactMap { URL(string: $0) }
        guard !urls.isEmpty else {
            call.reject("urls required")
            return
        }
        let captions = call.getArray("captions", String.self) ?? []
        let start = min(max(call.getInt("startIndex") ?? 0, 0), urls.count - 1)
        DispatchQueue.main.async { [weak self] in
            guard let presenter = self?.bridge?.viewController else {
                call.reject("no presenting view controller")
                return
            }
            let pager = NativePhotoPagerVC(urls: urls, captions: captions, startIndex: start)
            pager.onDismiss = { call.resolve() }
            presenter.present(pager, animated: true)
        }
    }
}
