import { useEffect, useRef, useState } from "react";
import type { Cut, CutPlan, Point } from "@spil/cutcode-core";
import { headAt, sampleArc } from "@spil/cutcode-core";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { needsQualityRamp } from "./graphicsProfile";
import { machineVisual, type Machine } from "./machines";
import { seqClock } from "./seqClock";
import { useAppStore } from "./store";

type Props = { sheet: CutPlan; machine: Machine };
type CamMode = "perspective" | "top";

function cutPolyline(cut: Cut, arcSegs = 28): Point[] {
  if (cut.type === "arc" && cut.center && cut.radius && cut.points.length >= 2) {
    const start = cut.points[0];
    const end = cut.points[1];
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-6) return [start];
    return sampleArc({ start, end, radius: cut.radius, side: cut.ccw ? -1 : 1 }, arcSegs);
  }
  return cut.points;
}

function prefixPolyline(pts: Point[], t: number): Point[] {
  if (pts.length === 0) return [];
  if (t <= 0) return [pts[0]];
  if (t >= 1 || pts.length === 1) return pts;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const target = Math.min(1, Math.max(0, t)) * total;
  const out: Point[] = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + len >= target) {
      const u = len < 1e-6 ? 1 : (target - acc) / len;
      out.push({
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u,
      });
      return out;
    }
    out.push(pts[i]);
    acc += len;
  }
  return out;
}

export function CutStage3D({ sheet, machine }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const camModeRef = useRef<CamMode>("perspective");
  const [camMode, setCamMode] = useState<CamMode>("perspective");
  const [progress, setProgress] = useState(-1);
  const [quality, setQuality] = useState(() => (needsQualityRamp() ? 0.7 : 1));
  const seqPlaying = useAppStore((s) => s.seqPlaying);
  const sw = sheet.sheet.width;
  const sh = sheet.sheet.height;

  useEffect(() => {
    let last = 0;
    const pull = () => {
      const now = performance.now();
      if (now - last < 40 && seqClock.progress >= 0) return;
      last = now;
      setProgress(seqClock.progress);
    };
    pull();
    return seqClock.subscribe(pull);
  }, [seqPlaying, sheet]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const full = quality >= 1;
    const arcSegs = full ? 28 : 20;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f1ea);
    if (full) scene.fog = new THREE.Fog(0xf5f1ea, 14, 32);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
    const perspectivePos = new THREE.Vector3(4.8, 4.8, 5.8);
    const topPos = new THREE.Vector3(0, 9.5, 0.02);
    camera.position.copy(perspectivePos);

    const renderer = new THREE.WebGLRenderer({
      antialias: full,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, full ? 2 : 1.4));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.6;
    controls.maxDistance = 16;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0, 0.15, 0);

    scene.add(new THREE.AmbientLight(0xfff5e8, 0.55));
    scene.add(new THREE.HemisphereLight(0xfff5e8, 0xc4b394, 0.35));
    const sun = new THREE.DirectionalLight(0xfff0d5, 1.05);
    sun.position.set(6, 10, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(full ? 2048 : 1024, full ? 2048 : 1024);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xc4b394, 0.28);
    fill.position.set(-4, 3, -2);
    scene.add(fill);

    const MM = 1000;
    const w = sw / MM;
    const d = sh / MM;
    const glassT = 0.012;
    const tableT = 0.08;
    const visual = machineVisual(machine);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(9, full ? 48 : 32),
      new THREE.MeshStandardMaterial({ color: 0xe8dfd0, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.22;
    floor.receiveShadow = true;
    scene.add(floor);

    const steel = new THREE.MeshStandardMaterial({ color: 0xd5dadd, roughness: 0.46, metalness: 0.22 });
    const steelDark = new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.38, metalness: 0.48 });
    const feltMat = new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.94, metalness: 0 });
    const frameMat = steel;
    const railMat = steelDark;
    const box = (sx: number, sy: number, sz: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    box(w + 0.22, 0.05, d + 0.16, steel, 0, 0.0, 0);
    const cols = 6;
    const rows = 4;
    for (let ix = 0; ix < cols; ix++) {
      for (let iz = 0; iz < rows; iz++) {
        const pw = (w - 0.08) / cols;
        const pd = (d - 0.08) / rows;
        box(pw - 0.012, 0.014, pd - 0.012, feltMat, -w / 2 + 0.04 + pw * (ix + 0.5), 0.032, -d / 2 + 0.04 + pd * (iz + 0.5));
      }
    }
    for (const z of [-(d / 2 + 0.12), d / 2 + 0.12]) {
      box(w + 0.55, 0.035, 0.045, railMat, 0, 0.07, z);
    }
    box(w + 0.36, 0.04, 0.035, frameMat, 0, -0.01, -(d / 2 + 0.14));
    box(w + 0.36, 0.04, 0.035, frameMat, 0, -0.01, d / 2 + 0.14);
    box(0.035, 0.04, d + 0.32, frameMat, -(w / 2 + 0.16), -0.01, 0);
    box(0.035, 0.04, d + 0.32, frameMat, w / 2 + 0.16, -0.01, 0);
    for (const x of [-w / 2, 0, w / 2]) {
      for (const z of [-d / 2, d / 2]) {
        box(0.06, 0.22, 0.06, frameMat, x, -0.12, z);
        box(0.1, 0.018, 0.1, railMat, x, -0.22, z);
      }
    }
    box(0.42, 0.16, 0.28, steelDark, -w / 2 + 0.35, -0.1, d / 2 - 0.2);
    if (visual.layout === "split") {
      const split = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, d + 0.25), frameMat);
      split.position.y = tableT + 0.01;
      scene.add(split);
    }
    if (visual.layout === "laminated") {
      const second = new THREE.Mesh(new THREE.BoxGeometry(w * 0.42, tableT, d + 0.2), new THREE.MeshStandardMaterial({ color: visual.bed, roughness: 0.9 }));
      second.position.set(w * 0.78, 0.015, 0);
      second.castShadow = true;
      scene.add(second);
    }
    if (visual.loadingArms) {
      for (const x of [-w * 0.34, 0, w * 0.34]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, d * 0.72), frameMat);
        arm.position.set(x, -0.03, -(d * 0.72));
        arm.rotation.x = -0.18;
        arm.castShadow = true;
        scene.add(arm);
      }
    }

    // Freestanding operator console, common on commercial cutting tables.
    const consoleGroup = new THREE.Group();
    box(0.22, 0.62, 0.16, frameMat, 0, 0.2, 0, consoleGroup);
    box(0.26, 0.03, 0.2, railMat, 0, -0.1, 0, consoleGroup);
    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.11, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x163848, emissive: 0x1d4e63, emissiveIntensity: 0.45, roughness: 0.25 })
    );
    screen.position.set(0, 0.38, -0.09);
    screen.rotation.x = -0.18;
    consoleGroup.add(screen);
    consoleGroup.position.set(visual.pedestal === "left" ? -w / 2 - 0.55 : w / 2 + 0.55, -0.08, d * 0.15);
    scene.add(consoleGroup);

    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(w, glassT, d),
      full
        ? new THREE.MeshPhysicalMaterial({
            color: 0xd7eef8,
            roughness: 0.06,
            metalness: 0,
            transmission: 0.72,
            thickness: 0.02,
            transparent: true,
            opacity: 0.92,
          })
        : new THREE.MeshStandardMaterial({
            color: 0xd7eef8,
            roughness: 0.08,
            metalness: 0.04,
            transparent: true,
            opacity: 0.86,
          })
    );
    glass.position.y = 0.062;
    glass.castShadow = true;
    glass.receiveShadow = true;
    scene.add(glass);

    const paneMat = new THREE.MeshStandardMaterial({
      color: 0xc5d4dc,
      transparent: true,
      opacity: 0.18,
      roughness: 0.4,
      side: THREE.DoubleSide,
    });
    for (const pane of sheet.panes) {
      const pts = pane.polygon && pane.polygon.length >= 3
        ? pane.polygon
        : [
            { x: pane.bounds.x, y: pane.bounds.y },
            { x: pane.bounds.x + pane.bounds.width, y: pane.bounds.y },
            { x: pane.bounds.x + pane.bounds.width, y: pane.bounds.y + pane.bounds.height },
            { x: pane.bounds.x, y: pane.bounds.y + pane.bounds.height },
          ];
      const shape = new THREE.Shape();
      pts.forEach((p, i) => {
        const x = p.x / MM - w / 2;
        const y = -(p.y / MM - d / 2);
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      });
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, paneMat);
      mesh.position.y = 0.072;
      scene.add(mesh);
    }

    const scoreMat = new THREE.LineBasicMaterial({ color: 0xc75d3f });
    const loweMat = new THREE.LineBasicMaterial({ color: 0xdc2626 });
    const activeMat = new THREE.LineBasicMaterial({ color: 0xf97316 });
    const scoreGroup = new THREE.Group();
    scene.add(scoreGroup);

    const gantry = new THREE.Group();
    box(w + 0.62, 0.045, 0.07, railMat, 0, 0.04, 0, gantry);
    box(w + 0.5, 0.02, 0.11, frameMat, 0, 0, 0, gantry);
    for (const x of [-(w / 2 + 0.22), w / 2 + 0.22]) {
      box(0.1, 0.14, 0.12, frameMat, x, -0.04, 0, gantry);
    }
    const head = box(0.08, 0.12, 0.08, steelDark, 0, -0.04, 0, gantry);
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.004, full ? 16 : 10),
      new THREE.MeshStandardMaterial({ color: 0xf4efe4, emissive: 0xc75d3f, emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.25 })
    );
    wheel.rotation.x = Math.PI / 2;
    wheel.position.y = -0.11;
    gantry.add(wheel);
    gantry.position.y = 0.16;
    scene.add(gantry);

    const toWorld = (p: Point, yOff = 0.006) =>
      new THREE.Vector3(p.x / MM - w / 2, 0.07 + yOff, p.y / MM - d / 2);

    const rapidMat = new THREE.LineDashedMaterial({
      color: 0x2a7553,
      dashSize: 0.05,
      gapSize: 0.032,
      transparent: true,
      opacity: 0.75,
    });
    const rapidGroup = new THREE.Group();
    scene.add(rapidGroup);
    const tl0 = seqClock.timeline;
    if (tl0) {
      for (const seg of tl0.segments) {
        if (seg.kind !== "rapid") continue;
        const geo = new THREE.BufferGeometry().setFromPoints([toWorld(seg.from, 0.02), toWorld(seg.to, 0.02)]);
        const line = new THREE.Line(geo, rapidMat);
        line.computeLineDistances();
        rapidGroup.add(line);
      }
    }

    const resize = () => {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let camAnim: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null = null;
    let lastMode = camModeRef.current;
    let lastScoreKey = "";
    let raf = 0;
    let alive = true;

    const tick = () => {
      const mode = camModeRef.current;
      if (mode !== lastMode) {
        lastMode = mode;
        camAnim = {
          from: camera.position.clone(),
          to: mode === "top" ? topPos : perspectivePos,
          fromTarget: controls.target.clone(),
          toTarget: new THREE.Vector3(0, 0.1, 0),
          t: 0,
        };
        controls.enabled = false;
      }
      if (camAnim) {
        camAnim.t = Math.min(1, camAnim.t + 0.02);
        const e = camAnim.t < 0.5 ? 2 * camAnim.t * camAnim.t : 1 - ((-2 * camAnim.t + 2) ** 2) / 2;
        camera.position.lerpVectors(camAnim.from, camAnim.to, e);
        controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, e);
        if (camAnim.t >= 1) {
          camAnim = null;
          controls.enabled = mode !== "top";
        }
      }

      const prog = seqClock.progress;
      const tl = seqClock.timeline;
      const h = seqClock.timeS >= 0 && tl ? headAt(tl, seqClock.timeS) : null;
      const scoreKey = `${prog}|${h?.activeCutIndex ?? ""}|${h?.cutProgress.toFixed(3) ?? ""}`;
      if (full || scoreKey !== lastScoreKey) {
        lastScoreKey = scoreKey;
        for (const child of [...scoreGroup.children]) {
          const line = child as THREE.Line;
          line.geometry.dispose();
          scoreGroup.remove(line);
        }
        sheet.cuts.forEach((cut) => {
          const poly = cutPolyline(cut, arcSegs);
          if (poly.length < 2) return;
          const active = h?.phase === "score" && h.activeCutIndex === cut.sequenceIndex;
          const hidden = prog >= 0 && cut.sequenceIndex > prog;
          if (hidden) return;
          const drawPts = active && h ? prefixPolyline(poly, h.cutProgress) : poly;
          if (drawPts.length < 2) return;
          const geo = new THREE.BufferGeometry().setFromPoints(drawPts.map((p) => toWorld(p)));
          scoreGroup.add(new THREE.Line(geo, active ? activeMat : cut.stageLabel === "Low-E" ? loweMat : scoreMat));
        });
      }
      let headPt: Point;
      if (h) {
        headPt = h.pos;
      } else {
        headPt = sheet.cuts[0] ? cutPolyline(sheet.cuts[0], arcSegs)[0] ?? { x: sw / 2, y: 40 } : { x: sw / 2, y: 40 };
      }
      const hp = toWorld(headPt);
      gantry.position.z = hp.z;
      head.position.x = hp.x;
      wheel.position.x = hp.x;

      controls.update();
      renderer.render(scene, camera);
      if (!full) {
        raf = requestAnimationFrame(() => {
          if (alive) setQuality(1);
        });
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [sheet, machine, sw, sh, quality]);

  const scored = progress < 0 ? sheet.cuts.length : Math.min(sheet.cuts.length, Math.floor(progress) + 1);
  const pct = sheet.cuts.length ? Math.round((scored / sheet.cuts.length) * 100) : 0;

  const chooseCam = (mode: CamMode) => {
    camModeRef.current = mode;
    setCamMode(mode);
  };

  return (
    <div className="stage3d">
      <div ref={mountRef} className="stage3d-mount" />
      <div className="hud hud-tl">
        <div>
          <div className="hud-kicker">Sheet</div>
          <div className="hud-strong">{Math.round(sw)} × {Math.round(sh)} <span>mm</span></div>
        </div>
        <div className="hud-rule" />
        <div>
          <div className="hud-kicker">Machine</div>
          <div className="hud-mono">{machine.brand} {machine.model}</div>
        </div>
      </div>
      <div className="hud hud-tr">
        <span className={`live-dot ${seqPlaying ? "on" : ""}`} />
        <span>{seqPlaying ? "Scoring" : seqClock.timeS >= 0 ? "Paused" : "Ready"}</span>
        <span className="hud-dim">·</span>
        <span className="hud-mono">{sheet.cuts.length} cuts</span>
      </div>
      <div className="hud hud-bl">
        <div className="hud-kicker">Sequence</div>
        <div className="hud-count">{scored}<span> / {sheet.cuts.length || 0}</span></div>
        <div className="meter"><div className="meter-fill" style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="hud hud-bc" onPointerDown={(e) => e.stopPropagation()}>
        <div className="view-toggle">
          <button type="button" className={camMode === "perspective" ? "active" : ""} onClick={() => chooseCam("perspective")}>
            3D
          </button>
          <button type="button" className={camMode === "top" ? "active" : ""} onClick={() => chooseCam("top")}>
            Top
          </button>
        </div>
      </div>
    </div>
  );
}
