// 카카오맵을 MapLibre처럼 쓸 수 있게 감싼 작은 어댑터.
// app.js가 쓰는 기능만 구현: 이동·확대, 마커, 선·면·점 레이어, 위성 전환, 좌표 변환.
(function () {
  const lv = (z) => Math.max(1, Math.min(14, Math.round(20 - z)));
  const zm = (l) => 20 - l;
  const ll = (c) => {
    if (Array.isArray(c)) return new kakao.maps.LatLng(c[1], c[0]);
    if (c && typeof c.lat === "number") return new kakao.maps.LatLng(c.lat, c.lng != null ? c.lng : c.lon);
    return c;
  };
  const colorOf = (v, f) => (Array.isArray(v) && v[0] === "get" ? (f.properties || {})[v[1]] : v) || "#E5406A";

  class KMap {
    constructor(o) {
      this.el = typeof o.container === "string" ? document.getElementById(o.container) : o.container;
      const interactive = o.interactive !== false;
      this.k = new kakao.maps.Map(this.el, {
        center: ll(o.center || [128.6, 35.87]),
        level: lv(o.zoom || 12),
        draggable: interactive,
        scrollwheel: interactive,
        disableDoubleClickZoom: !interactive,
      });
      if (!interactive) this.k.setZoomable(false);
      this.k.setMaxLevel(14);
      this.sources = {};
      this.layers = [];
      this.handlers = [];
      this.loaded = false;
      kakao.maps.event.addListener(this.k, "tilesloaded", () => {
        if (this.loaded) return;
        this.loaded = true;
        this.handlers.filter((h) => h.e === "load").forEach((h) => h.fn());
      });
    }
    on(e, fn) {
      const map = { zoom: "zoom_changed", moveend: "idle", move: "center_changed", click: "click" };
      if (e === "load") { this.handlers.push({ e, fn }); if (this.loaded) setTimeout(fn); return this; }
      const ke = map[e]; if (!ke) return this;
      const w = () => fn({ target: this });
      this.handlers.push({ e, fn, w, ke });
      kakao.maps.event.addListener(this.k, ke, w);
      return this;
    }
    off(e, fn) {
      this.handlers = this.handlers.filter((h) => {
        if (h.e === e && h.fn === fn) { if (h.ke) kakao.maps.event.removeListener(this.k, h.ke, h.w); return false; }
        return true;
      });
      return this;
    }
    _go(o, smooth) {
      if (o.zoom != null) { const L = lv(o.zoom); if (L !== this.k.getLevel()) { this.k.setLevel(L, smooth ? { animate: { duration: 280 } } : undefined); smooth = false; } }
      if (o.center) {
        const c = ll(o.center);
        if (o.offset && (o.offset[0] || o.offset[1])) {
          this.k.setCenter(c);
          this.k.panBy(-(o.offset[0] || 0), -(o.offset[1] || 0));
        } else if (smooth) this.k.panTo(c);
        else this.k.setCenter(c);
      }
    }
    flyTo(o) { this._go(o, true); return this; }
    easeTo(o) { this._go(o, true); return this; }
    jumpTo(o) { this._go(o, false); return this; }
    fitBounds(b, o = {}) {
      const bb = new kakao.maps.LatLngBounds(ll(b[0]), ll(b[1]));
      let p = o.padding || 0;
      if (typeof p === "number") p = { top: p, right: p, bottom: p, left: p };
      this.k.setBounds(bb, p.top || 0, p.right || 0, p.bottom || 0, p.left || 0);
      if (o.maxZoom != null && this.k.getLevel() < lv(o.maxZoom)) this.k.setLevel(lv(o.maxZoom));
      return this;
    }
    getCenter() { const c = this.k.getCenter(); return { lat: c.getLat(), lng: c.getLng() }; }
    getZoom() { return zm(this.k.getLevel()); }
    unproject(pt) {
      const c = this.k.getProjection().coordsFromContainerPoint(new kakao.maps.Point(pt[0], pt[1]));
      return { lat: c.getLat(), lng: c.getLng() };
    }
    project(c) { const p = this.k.getProjection().containerPointFromCoords(ll(c)); return { x: p.x, y: p.y }; }
    getContainer() { return this.el; }
    resize() { this.k.relayout(); return this; }
    remove() { this.layers.forEach((l) => this._clear(l)); this.el.innerHTML = ""; }
    getStyle() { return { layers: [] }; }
    setPaintProperty() {}
    setLayerZoomRange() {}
    setLayoutProperty(id, prop, val) {
      if (id === "sat" && prop === "visibility") this.k.setMapTypeId(val === "visible" ? kakao.maps.MapTypeId.HYBRID : kakao.maps.MapTypeId.ROADMAP);
    }
    addSource(id, s) {
      const self = this;
      this.sources[id] = { data: s.data || null, setData(d) { this.data = d; self._draw(id); } };
    }
    getSource(id) { return this.sources[id]; }
    addLayer(l) { if (l.type === "raster") return; this.layers.push({ ...l, shapes: [] }); this._draw(l.source); }
    _clear(l) { l.shapes.forEach((s) => s.setMap(null)); l.shapes = []; }
    _draw(src) {
      const s = this.sources[src];
      for (const l of this.layers.filter((x) => x.source === src)) {
        this._clear(l);
        const feats = (s && s.data && s.data.features) || [];
        const p = l.paint || {};
        for (const f of feats) {
          const g = f.geometry || {};
          if (l.type === "line") {
            const rings = g.type === "LineString" ? [g.coordinates] : g.type === "Polygon" ? g.coordinates : [];
            for (const r of rings) {
              l.shapes.push(new kakao.maps.Polyline({
                map: this.k, path: r.map((c) => ll(c)),
                strokeWeight: (f.properties && f.properties.dash ? 3 : typeof p["line-width"] === "number" ? p["line-width"] : 3), strokeColor: colorOf(p["line-color"], f),
                strokeOpacity: f.properties && f.properties.dash ? 0.45 : typeof p["line-opacity"] === "number" ? p["line-opacity"] : 0.9,
                strokeStyle: f.properties && f.properties.dash ? "shortdash" : p["line-dasharray"] ? (p["line-dasharray"][0] < 0.5 ? "shortdot" : "dash") : "solid",
              }));
            }
          } else if (l.type === "fill" && g.type === "Polygon") {
            l.shapes.push(new kakao.maps.Polygon({
              map: this.k, path: g.coordinates[0].map((c) => ll(c)), strokeWeight: 0,
              fillColor: colorOf(p["fill-color"], f), fillOpacity: p["fill-opacity"] != null ? p["fill-opacity"] : 0.2,
            }));
          } else if (l.type === "circle" && g.type === "Point") {
            const el = document.createElement("div");
            const r = Array.isArray(p["circle-radius"]) ? ((f.properties || {}).r || 5) : (p["circle-radius"] || 5);
            el.style.cssText = `width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:${p["circle-color"] ? colorOf(p["circle-color"], f) : "#fff"};border:${p["circle-stroke-width"] != null ? p["circle-stroke-width"] : 3}px solid ${p["circle-stroke-color"] ? colorOf(p["circle-stroke-color"], f) : "#fff"};box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.25)`;
            l.shapes.push(new kakao.maps.CustomOverlay({ map: this.k, position: ll(g.coordinates), content: el, xAnchor: 0.5, yAnchor: 0.5, zIndex: 1 }));
          }
        }
      }
    }
  }

  class KMarker {
    constructor(o = {}) {
      this.el = o.element || document.createElement("div");
      this.wrap = document.createElement("div");
      this.wrap.className = "kmk";
      const off = o.offset || [0, 0];
      if (off[0] || off[1]) this.wrap.style.transform = `translate(${off[0]}px, ${off[1]}px)`;
      this.wrap.appendChild(this.el);
      this.anchor = o.anchor || "center";
      this.pos = null;
      this.ov = null;
    }
    setLngLat(c) {
      this.pos = Array.isArray(c) ? { lng: c[0], lat: c[1] } : { lng: c.lng != null ? c.lng : c.lon, lat: c.lat };
      if (this.ov) this.ov.setPosition(ll(this.pos));
      return this;
    }
    getLngLat() { return this.pos; }
    getElement() { return this.el; }
    addTo(map) {
      this.ov = new kakao.maps.CustomOverlay({
        position: ll(this.pos), content: this.wrap, clickable: true,
        xAnchor: 0.5, yAnchor: this.anchor === "bottom" ? 1 : 0.5, zIndex: 3,
      });
      this.ov.setMap(map.k);
      return this;
    }
    remove() { if (this.ov) this.ov.setMap(null); this.ov = null; return this; }
  }

  window.KMap = KMap;
  window.KMarker = KMarker;
})();
