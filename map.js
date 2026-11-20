import { STYLES, PAL, POI, ROUTE, ME, styleOf, drawIcon } from './styles.js';
import { dist, project, calculateRoute, searchPhoton, reversePhoton, queryOverpass } from './routing.js';
import { $, IC, turnSvg, toast, el, getFavorites, isFavorite, toggleFavorite, getHistory, addHistory, initNetworkMonitor } from './ui.js';

if (typeof maplibregl === "undefined") {
  toast("Kartenbibliothek konnte nicht geladen werden – bitte online neu laden");
  throw new Error("MapLibre GL fehlt");
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

initNetworkMonitor();

$("styleBtn").innerHTML = IC.layers;
$("locBtn").innerHTML = IC.loc;
$("compassBtn").innerHTML = IC.compass;
$("ovBtn").innerHTML = IC.route;

let si = 0;
let rawMe = null, smoothMe = null;
let hdg = 0, first = true, follow = true, nav = false;
let dest = null, destMarker = null;
let waypoints = [], wpMarkers = [];
let searchMode = "dest"; // "dest" oder "waypoint"
let shape = [], cum = [], man = [], tripTime = 0, routeGeo = null, lastIdx = 0, spoke = {}, lastReroute = 0, wakeLock = null;
let speed = 0, acc = 0, compassOn = false, lastCam = 0, progress = 0, routeSeq = 0, searchSeq = 0, lastGeoErr = 0, meAdded = false;

const map = new maplibregl.Map({
  container: "map",
  style: styleOf(0),
  center: [10.4, 51.1],
  zoom: 5,
  maxPitch: 70,
  attributionControl: false
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), "top-left");

// Routen-Layer zuverlässig bei jedem Laden / Stilwechsel aufbauen
map.on("style.load", () => {
  addRoute();
  if (routeGeo && map.getSource("route")) {
    map.getSource("route").setData(routeGeo);
  }
});

map.on("styleimagemissing", e => {
  const [, g, k] = e.id.split("-");
  if (POI[g] && PAL[k]) {
    const c = drawIcon(g, k);
    map.addImage(e.id, c.getContext("2d").getImageData(0, 0, 64, 64), { pixelRatio: 2 });
  }
});

let lastErr = 0;
map.on("error", e => {
  if (Date.now() - lastErr > 6000) {
    lastErr = Date.now();
    if (!navigator.onLine) return;
    toast("Kartenfehler: " + ((e.error && e.error.message) || "unbekannt"));
  }
});

map.on("dragstart", () => { follow = false; updateCompassBtn(); });
map.on("rotate", updateCompassBtn);
map.on("pitch", updateCompassBtn);

// Fix für mobile Tastatur: verhindert Hängenbleiben des Viewports nach Schließen der Tastatur
window.addEventListener("scroll", () => {
  if (window.scrollY !== 0 || window.scrollX !== 0) {
    window.scrollTo(0, 0);
  }
});
$("q").addEventListener("blur", () => {
  setTimeout(() => {
    window.scrollTo(0, 0);
    map.resize();
  }, 150);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    window.scrollTo(0, 0);
    map.resize();
  });
}

function updateCompassBtn() {
  const btn = $("compassBtn");
  const rotated = Math.abs(map.getBearing()) > 2 || map.getPitch() > 2;
  if (rotated || (nav && !follow)) {
    btn.classList.remove("hidden");
  } else {
    btn.classList.add("hidden");
  }
}

$("compassBtn").onclick = () => {
  if (nav) {
    follow = true;
    camera(true);
  } else {
    map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
  }
  updateCompassBtn();
};

const KIND = {
  restaurant:"Restaurant",fast_food:"Imbiss",food_court:"Food Court",ice_cream:"Eisdiele",biergarten:"Biergarten",bakery:"Bäckerei",cafe:"Café",bar:"Bar",pub:"Kneipe",nightclub:"Nachtclub",
  fitness_centre:"Fitnessstudio",sports_centre:"Sportzentrum",gym:"Fitnessstudio",stadium:"Stadion",swimming_pool:"Schwimmbad",townhall:"Rathaus",courthouse:"Gericht",hospital:"Krankenhaus",
  clinic:"Klinik",doctors:"Arzt",pharmacy:"Apotheke",dentist:"Zahnarzt",school:"Schule",kindergarten:"Kindergarten",college:"Hochschule",university:"Universität",library:"Bibliothek",
  supermarket:"Supermarkt",grocery:"Lebensmittel",convenience:"Kiosk",department_store:"Kaufhaus",mall:"Einkaufszentrum",clothing_store:"Modegeschäft",fuel:"Tankstelle",
  charging_station:"Ladestation",hotel:"Hotel",hostel:"Hostel",motel:"Motel",guest_house:"Pension",parking:"Parkplatz",bank:"Bank",atm:"Geldautomat",post_office:"Post",police:"Polizei",
  fire_station:"Feuerwehr",museum:"Museum",cinema:"Kino",theatre:"Theater",castle:"Schloss",zoo:"Zoo",attraction:"Sehenswürdigkeit",pitch:"Sportplatz",swimming:"Schwimmbad",town_hall:"Rathaus",lodging:"Unterkunft",post:"Post",gymnasium:"Sporthalle"
};
const kindOf = p => KIND[p.subclass] || KIND[p.class] || String(p.subclass || p.class || "").replace(/_/g, " ");

map.on("click", e => {
  if (nav) return;
  if (searchMode === "waypoint") {
    addWaypoint({ name: "Gewählter Stopp", lngLat: [e.lngLat.lng, e.lngLat.lat] });
    exitWaypointSearch();
    return;
  }
  const r = 12, box = [[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]];
  const ids = Object.keys(POI).map(g => "poi_" + g).filter(id => map.getLayer(id));
  const f = ids.length ? map.queryRenderedFeatures(box, { layers: ids }).find(f => f.properties.name_de || f.properties.name) : null;
  if (f) {
    const p = f.properties, c = f.geometry.type === "Point" ? f.geometry.coordinates : [e.lngLat.lng, e.lngLat.lat];
    pick({ name: p.name_de || p.name, lngLat: c, sub: kindOf(p), place: true }, false);
    return;
  }
  pick({ name: "Gewählter Punkt", lngLat: [e.lngLat.lng, e.lngLat.lat] }, false);
});

const meEl = document.createElement("div");
meEl.className = "me";
const setMe = () => { meEl.innerHTML = ME[STYLES[si][1]]; };
setMe();
const meMarker = new maplibregl.Marker({ element: meEl, rotationAlignment: "map", pitchAlignment: "map" });

function animateMarker() {
  if (rawMe && smoothMe) {
    const d = dist(smoothMe, rawMe);
    if (d > 100 || d < 0.15) {
      smoothMe = [...rawMe];
    } else {
      smoothMe[0] += (rawMe[0] - smoothMe[0]) * 0.22;
      smoothMe[1] += (rawMe[1] - smoothMe[1]) * 0.22;
    }
    meMarker.setLngLat(smoothMe);
  }
  requestAnimationFrame(animateMarker);
}
requestAnimationFrame(animateMarker);

$("styleBtn").onclick = () => {
  si = (si + 1) % STYLES.length;
  map.setStyle(styleOf(si), { diff: false });
  setMe();
  toast(STYLES[si][0]);
  if (destMarker) {
    const ll = destMarker.getLngLat();
    destMarker.remove();
    destMarker = makeDest(ll);
  }
};

function makeDest(ll) {
  return new maplibregl.Marker({ color: STYLES[si][2] }).setLngLat(ll).addTo(map);
}

$("locBtn").onclick = () => {
  initCompass();
  follow = true;
  updateCompassBtn();
  if (nav) camera(true);
  else if (smoothMe) {
    map.easeTo({ center: smoothMe, zoom: Math.max(map.getZoom(), 15) });
  }
};

$("ovBtn").onclick = () => {
  if (!nav || !shape.length) return;
  if (follow) {
    follow = false;
    updateCompassBtn();
    const pts = shape.slice(lastIdx);
    if (!pts.length) return;
    const b = pts.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(pts[0], pts[0]));
    if (smoothMe) b.extend(smoothMe);
    const h = map.getContainer().clientHeight, pt = Math.min(230, h * 0.3), pb = Math.min(220, h * 0.28);
    map.fitBounds(b, { padding: { top: pt, bottom: pb, left: 40, right: 40 }, pitch: 0, bearing: 0, duration: 700 });
  } else {
    follow = true;
    updateCompassBtn();
    camera(true);
  }
};

$("banner").onclick = () => $("banner").classList.toggle("min");
$("stopBtn").onclick = () => stopNav();

let voice = true;
try { voice = localStorage.getItem("voice") !== "0"; } catch {}
const setVoiceIcon = () => { $("voiceBtn").innerHTML = voice ? IC.voice : IC.mute; };
setVoiceIcon();
$("voiceBtn").onclick = () => {
  voice = !voice;
  setVoiceIcon();
  try { localStorage.setItem("voice", voice ? "1" : "0"); } catch {}
  if (!voice && window.speechSynthesis) speechSynthesis.cancel();
  toast(voice ? "Sprachansagen an" : "Sprachansagen aus");
};

/* ---------- Standort & Kompass ---------- */
if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(onPos, e => {
    if (Date.now() - lastGeoErr > 15000) {
      lastGeoErr = Date.now();
      toast(e.code === 1 ? "Standortzugriff nicht erlaubt" : "GPS-Signal schwach");
    }
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
} else {
  toast("Standort wird nicht unterstützt");
}

const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
function setHeading(h) {
  const d = angDiff(h, hdg);
  if (Math.abs(d) < 1.5) return;
  hdg = (hdg + d * 0.4 + 360) % 360;
  meMarker.setRotation(hdg);
}

function onOri(e) {
  let h = null;
  if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = (360 - e.alpha) % 360;
  if (h == null || speed > 2) return;
  setHeading(h);
  if (nav && follow && Date.now() - lastCam > 600) {
    lastCam = Date.now();
    camera();
  }
}

function initCompass() {
  if (compassOn) return;
  const go = () => {
    compassOn = true;
    window.addEventListener("deviceorientationabsolute", onOri, true);
    window.addEventListener("deviceorientation", onOri, true);
  };
  const DO = window.DeviceOrientationEvent;
  if (DO && typeof DO.requestPermission === "function") {
    DO.requestPermission().then(r => { if (r === "granted") go(); else toast("Kompass nicht erlaubt"); }).catch(() => {});
  } else if (DO) go();
}
document.addEventListener("click", initCompass, { once: true });

function onPos(p) {
  const c = p.coords;
  rawMe = [c.longitude, c.latitude];
  if (!smoothMe) smoothMe = [...rawMe];

  acc = c.accuracy || 0;
  speed = c.speed > 0 ? c.speed : 0;
  const kmh = Math.round(speed * 3.6);
  const spdEl = $("speedVal");
  if (spdEl) spdEl.textContent = kmh;

  if (c.heading != null && !isNaN(c.heading) && speed > (compassOn ? 2 : 1)) setHeading(c.heading);
  meMarker.setLngLat(smoothMe).setRotation(hdg);
  if (!meAdded) { meMarker.addTo(map); meAdded = true; }

  if (first) {
    first = false;
    map.jumpTo({ center: smoothMe, zoom: 15 });
  }
  if (follow) camera();
  if (nav) navStep();
}

function camera(resetZoom) {
  const ctr = rawMe || smoothMe;
  if (!ctr) return;
  map.easeTo({
    center: ctr,
    bearing: nav ? hdg : map.getBearing(),
    zoom: nav && resetZoom ? 16.5 : map.getZoom(),
    pitch: nav ? 60 : map.getPitch(),
    padding: { top: nav ? 260 : 0, bottom: 0, left: 0, right: 0 },
    duration: 900
  });
}

/* ---------- Favoriten-Chips & Suchverlauf ---------- */
function renderChips() {
  const box = $("chips");
  box.innerHTML = "";
  const favs = getFavorites();
  const hist = getHistory().filter(h => !favs.some(f => f.name === h.name));

  favs.forEach(f => {
    const b = el("button", "chip fav");
    b.innerHTML = IC.starFill;
    b.append(document.createTextNode(f.name));
    b.onclick = () => handlePlaceSelection(f, true);
    box.append(b);
  });

  hist.slice(0, 5).forEach(h => {
    const b = el("button", "chip");
    b.textContent = h.name;
    b.onclick = () => handlePlaceSelection(h, true);
    box.append(b);
  });
}
renderChips();

/* ---------- Suche (Photon) für Ziel & Zwischenstopps ---------- */
let timer;
$("q").oninput = () => { clearTimeout(timer); timer = setTimeout(search, 350); };
$("qCancel").onclick = exitWaypointSearch;

function startWaypointSearch() {
  searchMode = "waypoint";
  $("sheet").classList.add("wp-mode");
  $("card").style.display = "none";
  $("results").innerHTML = "";
  $("q").value = "";
  $("q").placeholder = "Zwischenstopp suchen …";
  $("q").focus();
}

function exitWaypointSearch() {
  searchMode = "dest";
  $("sheet").classList.remove("wp-mode");
  $("results").innerHTML = "";
  $("q").value = "";
  $("q").placeholder = "Suche nach Orten";
  $("q").blur();
  if (dest) $("card").style.display = "block";
}

function handlePlaceSelection(placeObj, fly) {
  if (searchMode === "waypoint") {
    addWaypoint(placeObj);
    exitWaypointSearch();
  } else {
    pick(placeObj, fly);
  }
}

async function search() {
  const s = $("q").value.trim(), box = $("results"), my = ++searchSeq;
  box.innerHTML = "";
  if (s.length < 3) return;
  try {
    const features = await searchPhoton(s, rawMe);
    if (my !== searchSeq) return;
    features.forEach(f => {
      const p = f.properties, street = [p.street, p.housenumber].filter(Boolean).join(" ");
      const name = p.name || street;
      if (!name) return;
      const sub = [p.name ? street : "", p.city || p.town || p.village || p.locality || p.district, p.country].filter(Boolean).join(", ");
      const b = el("button", "row");
      const left = el("div");
      left.append(el("b", null, name), el("small", null, sub));
      b.append(left);
      const place = !!p.name && !["highway", "place", "boundary", "waterway"].includes(p.osm_key);
      const area = [[p.postcode, p.city || p.town || p.village || p.locality || p.district].filter(Boolean).join(" "), p.state, p.country].filter(Boolean).join(", ");
      const item = { name, lngLat: f.geometry.coordinates, sub, place, addr: p.name ? street : "", area, osm: { t: p.osm_type, id: p.osm_id } };
      b.onclick = () => handlePlaceSelection(item, true);
      box.append(b);
    });
  } catch {
    if (my === searchSeq) toast("Suche nicht erreichbar");
  }
}

function clearRoute() {
  routeGeo = null;
  shape = []; man = []; cum = [];
  map.getSource("route")?.setData({ type: "FeatureCollection", features: [] });
}

function pick(d, fly) {
  dest = d;
  waypoints = [];
  clearWaypointMarkers();
  clearRoute();
  $("results").innerHTML = "";
  $("q").value = "";
  $("q").blur();
  follow = false;
  updateCompassBtn();
  if (destMarker) destMarker.remove();
  destMarker = makeDest(d.lngLat);
  if (fly) map.flyTo({ center: d.lngLat, zoom: 15 });
  if (d.place) {
    enrich(d);
    locate(d);
  }
  addHistory(d);
  renderChips();
  renderPlace(d);
}

function addWaypoint(wp) {
  waypoints.push(wp);
  const m = new maplibregl.Marker({ color: "#ffffff", scale: 0.75 }).setLngLat(wp.lngLat).addTo(map);
  wpMarkers.push(m);
  toast("Zwischenstopp: " + wp.name);
  planRoute();
}

function clearWaypointMarkers() {
  wpMarkers.forEach(m => m.remove());
  wpMarkers = [];
}

function renderWaypointsList() {
  const box = $("waypoints");
  box.innerHTML = "";
  waypoints.forEach((wp, idx) => {
    const row = el("div", "wp-item");
    row.append(el("span", null, `Stopp ${idx + 1}: ${wp.name}`));
    const del = el("button", null, "✕");
    del.onclick = () => {
      waypoints.splice(idx, 1);
      wpMarkers[idx]?.remove();
      wpMarkers.splice(idx, 1);
      renderWaypointsList();
      if (dest && dest.routed) planRoute();
    };
    row.append(del);
    box.append(row);
  });
}

const ext = u => window.open(u, "_blank", "noopener");
const where = d => [d.addr, d.area].filter(Boolean).join(", ");
function gmaps(d) {
  const w = where(d);
  const q = w ? d.name + ", " + w : d.lngLat[1] + "," + d.lngLat[0];
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
}
function openWeb(d) {
  if (d.web) return ext(d.web);
  ext("https://www.google.com/search?hl=de&q=" + encodeURIComponent([d.name, where(d)].filter(Boolean).join(" ")));
}

async function locate(d) {
  if (d.area) return;
  const area = await reversePhoton(d.lngLat);
  if (area) d.area = area;
}

function renderPlace(d) {
  renderWaypointsList();
  const b = [["Route", planRoute, 1]];
  if (d.place) {
    b.push([d.web ? "@globe Webseite" : "@search Web-Suche", () => openWeb(d)]);
    b.push(["@pin Google Maps", () => ext(gmaps(d))]);
    b.push(["@close", cancel]);
  } else {
    b.push(["Schließen", cancel]);
  }
  showCard(d.name, d.sub || "", b, d);
}

async function enrich(d) {
  d.looking = true;
  try {
    const [lon, lat] = d.lngLat, ty = { N: "node", W: "way", R: "relation" }[d.osm && d.osm.t], id = d.osm && d.osm.id;
    const els = await queryOverpass(`[out:json][timeout:6];(${ty && id ? `${ty}(${id});` : ""}nwr(around:50,${lat},${lon})["name"];);out tags center 80;`);
    if (els) {
      const n = d.name.toLowerCase(), same = x => ["name", "name:de", "brand", "official_name"].some(k => x[k] && x[k].toLowerCase() === n);
      const hasW = x => x && (x.website || x["contact:website"] || x.url || x["contact:url"]);
      const own = ty && id ? (els.find(e => e.type === ty && e.id === id) || {}).tags : null;
      const all = els.map(e => e.tags || {});
      const t = hasW(own) ? own : (all.find(x => same(x) && hasW(x)) || own || all.find(same));
      if (t) {
        const w = t.website || t["contact:website"] || t.url || t["contact:url"];
        if (w) d.web = /^https?:\/\//i.test(w) ? w : "https://" + w;
        const a = [[t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" "), t["addr:city"]].filter(Boolean).join(", ");
        if (a) {
          d.addr = a;
          if (!d.osm) d.sub = [d.sub, a].filter(Boolean).join(" · ");
        }
      }
    }
  } catch {}
  d.looking = false;
  if (dest === d && !d.routed) renderPlace(d);
}

function showCard(t, s, btns, placeObj) {
  $("cTitle").textContent = t;
  $("cSub").textContent = s;
  const favBtn = $("favToggle");
  if (placeObj) {
    favBtn.style.display = "block";
    const updateFavIcon = () => {
      const active = isFavorite(placeObj);
      favBtn.classList.toggle("active", active);
      favBtn.innerHTML = active ? IC.starFill : IC.star;
    };
    updateFavIcon();
    favBtn.onclick = () => {
      toggleFavorite(placeObj);
      updateFavIcon();
      renderChips();
    };
  } else {
    favBtn.style.display = "none";
  }

  const b = $("cBtns");
  b.innerHTML = "";
  btns.forEach(([l, fn, p]) => {
    const x = el("button", "btn" + (p ? " p" : ""));
    const m = /^@(\w+)\s?(.*)$/.exec(l);
    if (m) {
      x.innerHTML = IC[m[1]];
      if (m[2]) x.append(m[2]);
      else x.setAttribute("aria-label", "Schließen");
    } else x.textContent = l;
    x.onclick = fn;
    b.append(x);
  });
  $("card").style.display = "block";
}

function cancel() {
  $("card").style.display = "none";
  $("waypoints").innerHTML = "";
  searchMode = "dest";
  $("sheet").classList.remove("wp-mode");
  $("q").placeholder = "Suche nach Orten";
  dest = null;
  waypoints = [];
  clearWaypointMarkers();
  routeSeq++;
  clearRoute();
  if (destMarker) {
    destMarker.remove();
    destMarker = null;
  }
}

/* ---------- Routing ---------- */
async function fetchRoute() {
  if (!dest || !rawMe) throw new Error("Kein Ziel");
  const target = dest, res = await calculateRoute(rawMe, waypoints, target.lngLat);
  if (dest !== target) throw new Error("Ziel geändert");
  shape = res.shape;
  man = res.man;
  cum = res.cum;
  tripTime = res.tripTime;
  routeGeo = { type: "Feature", geometry: { type: "LineString", coordinates: shape } };
  if (!map.getSource("route")) addRoute();
  map.getSource("route")?.setData(routeGeo);
  lastIdx = 0;
  spoke = {};
  return res.summary;
}

async function planRoute() {
  if (!rawMe) {
    toast("Warte auf GPS …");
    return;
  }
  if (!navigator.onLine) {
    toast("Offline – Route kann nicht berechnet werden");
    return;
  }
  if (!dest) return;
  const my = ++routeSeq;
  try {
    const s = await fetchRoute();
    if (my !== routeSeq || !dest) return;
    const b = shape.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(shape[0], shape[0]));
    map.fitBounds(b, { padding: { top: 80, bottom: 260, left: 40, right: 40 } });
    dest.routed = true;
    renderWaypointsList();
    showCard(
      `${s.length.toFixed(1)} km · ${Math.round(s.time / 60)} min`,
      dest.name,
      [
        ["Los", startNav, 1],
        ["@plus Stopp", startWaypointSearch],
        ["Abbrechen", cancel]
      ],
      dest
    );
  } catch (err) {
    if (my !== routeSeq) return;
    const msg = String((err && err.message) || "");
    toast(/no route|no suitable|found/i.test(msg) ? "Keine Route gefunden" : "Routing nicht erreichbar");
  }
}

const rw = w => ["interpolate", ["linear"], ["zoom"], 9, w * 0.45, 15, w, 19, w * 1.7];
function addRoute() {
  if (map.getSource("route")) return;
  const R = ROUTE[STYLES[si][1]];
  map.addSource("route", { type: "geojson", data: routeGeo || { type: "FeatureCollection", features: [] } });
  const lay = { "line-cap": "round", "line-join": "round" };
  const before = map.getLayer("road_labels") ? "road_labels" : undefined;
  map.addLayer({ id: "route-casing", type: "line", source: "route", layout: lay, paint: { "line-color": R.cc, "line-opacity": R.co, "line-width": rw(R.cw) } }, before);
  map.addLayer({ id: "route-line", type: "line", source: "route", layout: lay, paint: { "line-color": R.col, "line-opacity": R.op, "line-width": rw(R.w) } }, before);
}

/* ---------- Navigation ---------- */
const fmt = d => {
  const m = d < 150 ? Math.max(10, Math.round(d / 10) * 10) : Math.round(d / 50) * 50;
  return m >= 1000 ? (d / 1000).toFixed(1).replace(".", ",") + " km" : m + " m";
};
function speak(t) {
  if (!voice || !t || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(t);
  u.lang = "de-DE";
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
async function wake() {
  if (wakeLock && !wakeLock.released) return;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => { if (nav && document.visibilityState === "visible") wake(); });

function startNav() {
  initCompass();
  nav = true;
  follow = true;
  updateCompassBtn();
  document.body.classList.add("nav");
  $("banner").classList.remove("min");
  $("card").style.display = "none";
  speak("Navigation gestartet");
  wake();
  camera(true);
  if (shape.length > 0) navStep();
}

function stopNav(arrived) {
  nav = false;
  document.body.classList.remove("nav");
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  if (!arrived && window.speechSynthesis) speechSynthesis.cancel();
  cancel();
  map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  updateCompassBtn();
}

// Zwischenstopps, die man erreicht hat, nicht mehr für die Neuberechnung verwenden
function passWaypoints() {
  for (let i = waypoints.length - 1; i >= 0; i--) {
    if (dist(rawMe, waypoints[i].lngLat) < 50) {
      waypoints.splice(i, 1);
      wpMarkers[i]?.remove();
      wpMarkers.splice(i, 1);
    }
  }
}

// Position auf die Route projizieren (Abstand zu Strecken, nicht nur zu Stützpunkten)
function matchRoute() {
  let bi = -1, bd = 1e12, bt = 0;
  for (let i = Math.max(0, lastIdx - 3); i < shape.length - 1; i++) {
    if (i > lastIdx + 3 && cum[i] - cum[lastIdx] > 1500) break;
    const r = project(rawMe, shape[i], shape[i + 1]);
    if (r.d < bd) { bd = r.d; bi = i; bt = r.t; }
  }
  return { bi, bd, bt };
}

async function navStep() {
  if (!rawMe || shape.length < 2) return;
  passWaypoints();
  const { bi, bd, bt } = matchRoute();
  if (bi < 0 || bd > Math.max(60, Math.min(acc * 1.5, 200))) {
    if (!navigator.onLine) {
      if (Date.now() - lastReroute > 15000) {
        lastReroute = Date.now();
        toast("Offline – Neuberechnung pausiert");
      }
      return;
    }
    if (Date.now() - lastReroute > 10000) {
      lastReroute = Date.now();
      speak("Route wird neu berechnet");
      try { await fetchRoute(); } catch { if (nav) toast("Neuberechnung fehlgeschlagen"); }
    }
    return;
  }
  lastIdx = bi;
  progress = cum[bi] + bt * (cum[bi + 1] - cum[bi]);
  const total = cum[cum.length - 1], rem = Math.max(0, total - progress);
  if (rem < 25) {
    speak("Sie haben Ihr Ziel erreicht");
    stopNav(true);
    return;
  }
  const k = man.findIndex((m, i) => i > 0 && m.begin_shape_index > bi);
  if (k < 0) return;
  const m = man[k], d = Math.max(0, cum[m.begin_shape_index] - progress);
  const ico = $("bIco");
  if (ico.dataset.t != m.type) { ico.dataset.t = m.type; ico.innerHTML = turnSvg(m.type); }
  $("bDist").textContent = fmt(d);
  $("bText").textContent = m.instruction;
  const n = man[k + 1];
  $("b2").hidden = !n;
  if (n) {
    const i2 = $("b2Ico");
    if (i2.dataset.t != n.type) { i2.dataset.t = n.type; i2.innerHTML = turnSvg(n.type); }
    $("b2Text").textContent = n.instruction;
  }
  const mins = Math.max(1, Math.round(tripTime * (total > 0 ? rem / total : 0) / 60));
  $("eta").textContent = new Date(Date.now() + mins * 60000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  $("remT").textContent = mins >= 60 ? Math.floor(mins / 60) + ":" + String(mins % 60).padStart(2, "0") : mins;
  $("remTL").textContent = mins >= 60 ? "Std." : "Min.";
  $("remD").textContent = (rem / 1000).toFixed(1).replace(".", ",");
  const st = spoke[k] || 0;
  if (d <= 80 && st < 2) { spoke[k] = 2; speak(m.instruction); }
  else if (d <= 450 && st < 1) { spoke[k] = 1; speak("In " + Math.round(d / 50) * 50 + " Metern: " + m.instruction); }
}
