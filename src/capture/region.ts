export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Translate the iframe's CSS-pixel bounding box into pixel coordinates of an
 * actual screencast frame (which may be at devicePixelRatio scale).
 */
export function cssRectToFramePixels(
  rect: { x: number; y: number; width: number; height: number },
  frameSize: { width: number; height: number },
  pageCssSize: { width: number; height: number },
): CropRect {
  const scaleX = frameSize.width / pageCssSize.width;
  const scaleY = frameSize.height / pageCssSize.height;
  const left = Math.max(0, Math.round(rect.x * scaleX));
  const top = Math.max(0, Math.round(rect.y * scaleY));
  return {
    left,
    top,
    width: Math.min(Math.round(rect.width * scaleX), frameSize.width - left),
    height: Math.min(Math.round(rect.height * scaleY), frameSize.height - top),
  };
}
