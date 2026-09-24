/**
 * Every PC ends at full 3D quality. Low-end GPUs only *boot* cheaper (~70%),
 * then promote to 100% on the first rendered frame.
 */
export function needsQualityRamp(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true })
      ?? canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
    if (!gl) return true;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "").toLowerCase() : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (/nvidia|geforce|rtx|gtx|radeon rx|radeon pro|apple m[0-9]|apple gpu|intel arc/.test(renderer)) {
      return false;
    }
    if (/swiftshader|llvmpipe|microsoft basic|intel|uhd|iris|hd graphics|mali|adreno|powervr/.test(renderer)) {
      return true;
    }
  } catch {
    return true;
  }
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (mem != null && mem <= 4) return true;
  return cores <= 4;
}

export function prefetchStage3D() {
  void import("./CutStage3D");
}
