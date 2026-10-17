// Touchpad-friendly map scrolling for the admin maps (Leaflet).
//
// Leaflet zooms on every wheel event, but a two-finger swipe on a touchpad is a
// wheel event too, so trying to move the map zoomed it instead. Here:
// - scroll / two-finger swipe → pans the map (in both directions);
// - pinch (the browser sends it as Ctrl + wheel) or Ctrl/⌘ + scroll → zooms
//   around the pointer.
// The +/- buttons, double-click and dragging work as before.

import type { Map as LMap } from 'leaflet';

export function touchpadFriendlyWheel(map: LMap) {
  map.scrollWheelZoom.disable();
  const el = map.getContainer();
  let zoomAcc = 0;
  const onWheel = (e: WheelEvent) => {
    e.preventDefault(); // the page doesn't scroll while the pointer is on the map
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1; // lines / pages → pixels
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      // Pinch gestures come in many small steps: add them up, zoom in half steps.
      zoomAcc += dy;
      if (Math.abs(zoomAcc) < 40) return;
      const step = zoomAcc > 0 ? -0.5 : 0.5;
      zoomAcc = 0;
      const rect = el.getBoundingClientRect();
      const at = map.containerPointToLatLng([e.clientX - rect.left, e.clientY - rect.top]);
      map.setZoomAround(at, map.getZoom() + step, { animate: false });
      return;
    }
    map.panBy([dx, dy], { animate: false });
  };
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => el.removeEventListener('wheel', onWheel);
}
