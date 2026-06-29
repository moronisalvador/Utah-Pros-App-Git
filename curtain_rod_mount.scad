// ============================================================
//  PARAMETRIC CURTAIN ROD WALL MOUNT
// ============================================================
//  A wall-mounted bracket that holds a curtain rod a fixed
//  distance out from the wall. Modern cantilever style: it is made of:
//    - a flat WALL PLATE with two stacked screw holes (against the wall)
//    - a horizontal SUPPORT ARM carrying the rod out from the wall
//    - an open-top C-CRADLE at the end that the rod drops into
//    - a curved GUSSET under the arm whose underside sweeps in one
//      smooth concave curve from the cradle down to the wall base
//
//  The arm + cradle + gusset are built as ONE rounded side-profile,
//  extruded along X, so the whole thing reads as a single sweep.
//
//  ALL dimensions are in millimeters (mm). Inch inputs use in().
//
//  ORIENTATION (model space):
//    Wall surface is the X-Z plane at Y = 0.
//    +Y points OUT from the wall.  +Z is up.  +X runs along the
//    wall / rod axis. Everything is centered on Z = 0 and X = 0.
//
//  ─────────────────────────────────────────────────────────
//  3D PRINTING NOTES  (Bambu Lab H2D — ASA or Nylon)
//  ─────────────────────────────────────────────────────────
//   * PRINT ORIENTATION: lay the bracket ON ITS SIDE — one flat
//     X-face on the bed, the whole arm/cradle profile parallel to
//     the plate. The arm+cradle is literally an extrusion of that
//     side profile along X, so this orientation is layer-perfect:
//     the rod's downward load stays IN-PLANE with the layers
//     (no peeling at the arm root, the failure mode for a 4"
//     cantilever) and the C-cup + curved underside print support-free.
//   * MATERIAL: set `material` to "ASA" or "NYLON" to auto-pick
//     the rod-bore clearance (Nylon swells, so looser bore +
//     slightly larger screw holes). "MANUAL" = drive it yourself.
//   * ASA: enclosed chamber ~45C, 8-10mm brim. The wide flat plate
//     is the warp-prone part; rounded corners + the front chamfer
//     here help it stay down.
//   * NYLON: dry the filament; expect ~1-1.5% shrink — test the
//     rod fit on a print before committing.
//   * Strength: >=4 walls, >=40% infill on the arm.
// ============================================================

// ---- helper: convert inches to millimeters --------------------------------
function in(x) = x * 25.4;

// ============================================================
//  PARAMETERS  (edit these)
// ============================================================

// ---- Material preset (drives fit clearances) -------------------------------
material              = "ASA";     // "ASA" | "NYLON" | "MANUAL"

// ---- Core requested dimensions --------------------------------------------
rod_diameter          = 18;        // [mm] diameter of the curtain rod
wall_to_rod_center    = in(4);     // [mm] wall surface -> center of rod (4 in = 101.6)
wall_plate_thickness  = 5;         // [mm] thickness of the flat wall plate
num_screw_holes       = 2;         // number of mounting screw holes
screw_hole_diameter   = 4.4;       // [mm] clearance hole for a #8 screw (~4.2-4.5)

// ---- Wall plate ------------------------------------------------------------
//  The rod sits near the TOP of the plate; the plate runs down below it so the
//  curved support and the lower screw have room (the modern cantilever look).
plate_width           = 34;        // [mm] horizontal width of the wall plate (X)
plate_above_rod       = 15;        // [mm] plate extends this far ABOVE the rod center (Z)
plate_below_rod       = 52;        // [mm] plate extends this far BELOW the rod center (Z)
plate_corner_radius   = 8;         // [mm] rounded corner radius (0 = square corners)
front_chamfer         = 1.2;       // [mm] cosmetic bevel on the room-facing plate edge

// ---- Screw holes -----------------------------------------------------------
screw_hole_edge_inset = 13;        // [mm] hole center distance in from top/bottom edge
countersink_enabled   = true;      // true = cone for a flat-head #8 to sit flush
countersink_diameter  = 9;         // [mm] outer diameter of the countersink cone
countersink_depth     = 2.6;       // [mm] depth of the countersink cone

// ---- Support body (horizontal arm + curved gusset) -------------------------
//  A horizontal arm carries the rod cradle out from the wall; a curved gusset
//  fills the corner under the arm near the wall for strength, with open space
//  under the outer arm so it reads light and sculpted (the modern look).
body_width            = 18;        // [mm] width of the body along X (= cradle length)
arm_thickness         = 16;        // [mm] thickness of the horizontal arm bar (Z)
arm_base_drop         = 46;        // [mm] gusset depth below the rod center at the wall (Z)
gusset_reach          = 96;        // [mm] how far the curved gusset extends out under the arm (Y)
edge_fillet           = 4;         // [mm] rounding applied to the whole side profile

// ---- Gusset curve ----------------------------------------------------------
//  The gusset's outer edge is a quarter-ellipse sweeping from the toe (under the
//  arm) down to the wall base. concave = the hollow shelf-bracket look;
//  set false for a straight triangular gusset edge.
gusset_concave        = true;

// ---- Rod cradle (the ring that holds the rod) ------------------------------
cradle_wall           = 5;         // [mm] wall thickness of the ring around the rod
cradle_opening_deg    = 100;       // [deg] angular size of the open top slot (0 = closed ring)
cradle_opening_bias   = -22;         // [deg] tilt the opening toward the room (+) to clean the top blend
cradle_rim_chamfer    = 1.0;       // [mm] cosmetic 45 chamfer on the cradle end rims
rod_clearance         = 0.6;       // [mm] MANUAL bore clearance (used only when material="MANUAL")

// ---- Quality ---------------------------------------------------------------
$fn                   = 120;       // smoothness of curves (higher = smoother, slower)

// ============================================================
//  MATERIAL-DRIVEN FIT  (auto clearances by material)
// ============================================================
function rod_clearance_eff() =
    (material == "NYLON") ? 0.9 :
    (material == "ASA")   ? 0.6 :
                            rod_clearance;           // MANUAL
function screw_extra_eff() =
    (material == "NYLON") ? 0.3 : 0.0;

// ============================================================
//  DERIVED VALUES
// ============================================================
rod_bore_d   = rod_diameter + rod_clearance_eff();    // inner bore that holds the rod
screw_d      = screw_hole_diameter + screw_extra_eff();
cradle_outer = rod_bore_d + 2 * cradle_wall;          // outer diameter of the cradle ring
arm_length   = wall_to_rod_center;                    // wall surface -> rod center (Y)
plate_height   = plate_above_rod + plate_below_rod;             // total plate height (Z)
plate_center_z = (plate_above_rod - plate_below_rod) / 2;       // plate midpoint (rod is near top)

// ============================================================
//  TOP-LEVEL ASSEMBLY
// ============================================================
module curtain_rod_mount() {
    difference() {
        union() {
            plate_body();
            arm_body();
        }
        screw_cutouts();
        rod_bore_and_slot();
    }
}

// ─── SECTION: Wall plate ──────────────
//  Rounded rectangle (X by Z) extruded out from the wall (+Y), with a cosmetic
//  chamfer on the room-facing front edge.
module plate_body() {
    c = max(0, min(front_chamfer, wall_plate_thickness - 0.5));
    translate([0, 0, plate_center_z]) {
        rotate([-90, 0, 0])
            linear_extrude(height = wall_plate_thickness - c)
                rounded_rect(plate_width, plate_height, plate_corner_radius);
        if (c > 0)
            translate([0, wall_plate_thickness - c, 0])
                rotate([-90, 0, 0])
                    linear_extrude(height = c, scale = front_scale(c))
                        rounded_rect(plate_width, plate_height, plate_corner_radius);
    }
}
function front_scale(c) =
    [ (plate_width  - 2 * c) / plate_width,
      (plate_height - 2 * c) / plate_height ];

// ─── SECTION: Arm + cradle body ──────────────
//  The arm/cradle side profile lives in the Y-Z plane; we extrude it along X
//  (centered) to form a constant-width body. multmatrix maps the drawing's
//  (x,y) -> world (Y,Z) and the extrude direction -> world X.
module arm_body() {
    c = (cradle_rim_chamfer > 0)
            ? min(cradle_rim_chamfer, cradle_wall - 0.5, 3)
            : 0;
    translate([-body_width/2, 0, 0])
        multmatrix([[0,0,1,0],[1,0,0,0],[0,1,0,0],[0,0,0,1]]) {
            if (c > 0) {
                end_chamfer_cap(c);                                     // near X face
                translate([0, 0, c])
                    linear_extrude(height = body_width - 2*c) arm_profile_2d();
                translate([0, 0, body_width]) mirror([0, 0, 1])
                    end_chamfer_cap(c);                                 // far X face
            } else {
                linear_extrude(height = body_width) arm_profile_2d();
            }
        }
}

//  One end cap that bevels the whole face perimeter inward by `c` (a true
//  chamfer on both X-faces). Insetting the solid profile can't create floaters,
//  unlike subtracting a cone from the finished ring.
module end_chamfer_cap(c) {
    hull() {
        linear_extrude(0.01) offset(r = -c) arm_profile_2d();
        translate([0, 0, c - 0.01]) linear_extrude(0.01) arm_profile_2d();
    }
}

//  2D side profile (drawing-x = world Y "out from wall", drawing-y = world Z up).
//  A horizontal arm bar (wall -> cradle) plus a curved gusset filling the corner
//  under the arm near the wall. The gusset's outer edge is carved concave so it
//  sweeps from the arm underside down to the wall base; the space under the
//  outer arm stays open, giving the light, modern, sculpted look.
module arm_profile_2d() {
    offset(r = edge_fillet) offset(delta = -edge_fillet)
        union() {
            // horizontal arm: wall bar -> cradle circle (rod centered on it)
            hull() {
                translate([0, -arm_thickness/2]) square([3, arm_thickness]);
                translate([arm_length, 0]) circle(d = cradle_outer);
            }
            gusset_2d();
        }
}

//  Curved gusset under the arm near the wall: a right-triangle whose outer edge
//  (toe -> wall base) is a concave quarter-ellipse, giving the hollow
//  shelf-bracket sweep. The space under the OUTER arm stays open.
module gusset_2d() {
    a  = gusset_reach;                         // horizontal reach (Y)
    b  = arm_base_drop - arm_thickness/2;      // vertical drop of the curve (Z)
    z0 = -arm_thickness/2;                     // gusset top = arm underside
    // ellipse centered on the OUTER corner so the toe->base edge bows INWARD
    ox = gusset_reach; oz = -arm_base_drop;
    polygon(concat(
        [[0, z0]],                                                       // top at wall
        gusset_concave
            ? [for (t = [90:3:180]) [ox + a * cos(t), oz + b * sin(t)]]  // toe -> base (hollow)
            : [[a, z0], [0, z0 - b]]                                     // straight triangle
    ));
}

// ─── SECTION: Cutouts ──────────────
//  Rod bore + open top slot + cosmetic rim chamfers, all on the rod axis (X).
module rod_bore_and_slot() {
    translate([0, arm_length, 0])
        rotate([0, 90, 0]) {
            // bore for the rod
            translate([0, 0, -body_width/2 - 0.1])
                cylinder(h = body_width + 0.2, d = rod_bore_d);
            // open top slot so the rod drops in from above (world +Z)
            if (cradle_opening_deg > 0)
                rotate([0, 0, 180 - cradle_opening_deg/2 + cradle_opening_bias])
                    slot_wedge(cradle_opening_deg, cradle_outer/2 + 1, body_width + 0.2);
        }
}

//  Screw clearance holes (+ optional countersinks) through the plate along +Y.
module screw_cutouts() {
    for (z = screw_z_positions())
        translate([0, -0.1, z])
            rotate([-90, 0, 0]) {
                cylinder(h = wall_plate_thickness + 0.2, d = screw_d);
                if (countersink_enabled)
                    translate([0, 0, wall_plate_thickness - countersink_depth + 0.01])
                        cylinder(h = countersink_depth + 0.1,
                                 d1 = screw_d, d2 = countersink_diameter);
            }
}

// ─── SECTION: Helpers ──────────────

// Rounded rectangle, centered on both axes (X = width, Y = height).
module rounded_rect(w, h, r) {
    r2 = max(0, min(r, min(w, h) / 2));
    offset(r = r2) offset(delta = -r2)
        square([w, h], center = true);
}

// Pie-slice wedge spanning [0 .. angle] degrees, used to cut the cradle slot.
module slot_wedge(angle, radius, depth) {
    translate([0, 0, -depth/2])
        linear_extrude(height = depth)
            polygon(points = concat(
                [[0, 0]],
                [for (a = [0 : 2 : angle]) [radius * cos(a), radius * sin(a)]],
                [[radius * cos(angle), radius * sin(angle)]]
            ));
}

// Vertical (Z) positions of the screw holes: top one near the rod, bottom one
// near the base, evenly spread between (rod sits near the top of the plate).
function screw_z_positions() =
    let (top = plate_above_rod - screw_hole_edge_inset,
         bot = -plate_below_rod + screw_hole_edge_inset)
    (num_screw_holes <= 1)
        ? [(top + bot) / 2]
        : [for (i = [0 : num_screw_holes - 1])
              top - i * (top - bot) / (num_screw_holes - 1)];

// ============================================================
//  RENDER
// ============================================================
curtain_rod_mount();
