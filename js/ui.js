export const $=id=>document.getElementById(id);

const sv=(d,fill)=>'<svg viewBox="0 0 24 24" width="18" height="18" fill="'+(fill||"none")+'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+d+'</svg>';
export const IC={
 layers:sv('<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>'),
 loc:sv('<path d="M20 4L4 11.2l6.6 2.2L12.8 20z"/>',"currentColor"),
 compass:sv('<circle cx="12" cy="12" r="9"/><polygon points="12,6 15,12 12,18 9,12" fill="currentColor"/>'),
 voice:sv('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>'),
 mute:sv('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor"/><path d="M4 4l16 16"/>'),
 route:sv('<circle cx="7" cy="5.5" r="2.3"/><path d="M7 8c0 5 10 2 10 7"/><circle cx="17" cy="18" r="2.6" fill="currentColor"/>'),
 globe:sv('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>'),
 search:sv('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>'),
 pin:sv('<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
 close:sv('<path d="M6 6l12 12M18 6L6 18"/>'),
 star:sv('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'),
 starFill:sv('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',"currentColor"),
 plus:sv('<path d="M12 5v14M5 12h14"/>')
};

const TURN={9:35,10:90,11:135,14:-135,15:-90,16:-35,18:35,19:-35,20:35,21:-35,23:35,24:-35,37:35,38:-35};
export function turnSvg(type){
  const W='<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">';
  if(type===4||type===5||type===6)return W+'<path d="M32 58S14 41 14 26a18 18 0 0 1 36 0c0 15-18 32-18 32z"/><circle cx="32" cy="26" r="6" fill="currentColor"/></svg>';
  if(type===12||type===13)return W+'<g'+(type===12?' transform="matrix(-1 0 0 1 64 0)"':'')+'><path d="M44 58V28a12 12 0 0 0-24 0v18M10 38l10 10 10-10"/></g></svg>';
  if(type===26||type===27)return W+'<circle cx="32" cy="34" r="11"/><path d="M32 58V45M32 23V7M22 17L32 7l10 10"/></svg>';
  const a=(TURN[type]||0)*Math.PI/180,sharp=Math.abs(a)>1.6,L=a===0?28:(Math.abs(a)<1?32:(sharp?36:24)),d=[Math.sin(a),-Math.cos(a)];
  const cy=sharp?-8:0,C=[0,cy],S=[0,cy+(sharp?38:28)];
  const E=a===0?[0,-28]:[d[0]*L,cy+d[1]*L],rot=(v,t)=>[v[0]*Math.cos(t)-v[1]*Math.sin(t),v[0]*Math.sin(t)+v[1]*Math.cos(t)];
  const back=[-d[0],-d[1]],h1=rot(back,Math.PI/4),h2=rot(back,-Math.PI/4),H=12;
  const A1=[E[0]+H*h1[0],E[1]+H*h1[1]],A2=[E[0]+H*h2[0],E[1]+H*h2[1]];
  const pts=[S,E,A1,A2,C],xs=pts.map(q=>q[0]),ys=pts.map(q=>q[1]);
  const tx=32-(Math.min(...xs)+Math.max(...xs))/2,ty=32-(Math.min(...ys)+Math.max(...ys))/2,f=n=>n.toFixed(1);
  let path;
  if(a===0)path='M0 28L0 -28';
  else{const r=9,P1=[0,cy+r],P2=[d[0]*r,cy+d[1]*r];path=`M${f(S[0])} ${f(S[1])}L${f(P1[0])} ${f(P1[1])}Q${f(C[0])} ${f(C[1])} ${f(P2[0])} ${f(P2[1])}L${f(E[0])} ${f(E[1])}`}
  path+=`M${f(A1[0])} ${f(A1[1])}L${f(E[0])} ${f(E[1])}L${f(A2[0])} ${f(A2[1])}`;
  return W+`<g transform="translate(${f(tx)} ${f(ty)})"><path d="${path}"/></g></svg>`;
}

export function toast(t){
  const e=$("toast");
  e.textContent=t;
  e.style.opacity=1;
  setTimeout(()=>e.style.opacity=0,2200);
}

export function el(tag,cls,text){
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  if(text!=null)e.textContent=text;
  return e;
}

// Favoriten & Verlauf im LocalStorage
const FAV_KEY = "gamemap_favs";
const HIST_KEY = "gamemap_hist";

export function getFavorites(){
  try{ return JSON.parse(localStorage.getItem(FAV_KEY)) || []; }catch{ return []; }
}

export function isFavorite(place){
  if(!place) return false;
  return getFavorites().some(f => f.name === place.name && Math.abs(f.lngLat[0]-place.lngLat[0]) < 0.0005);
}

export function toggleFavorite(place){
  let favs = getFavorites();
  const idx = favs.findIndex(f => f.name === place.name && Math.abs(f.lngLat[0]-place.lngLat[0]) < 0.0005);
  if(idx >= 0){
    favs.splice(idx, 1);
    toast("Aus Favoriten entfernt");
  } else {
    favs.unshift({name: place.name, lngLat: place.lngLat, sub: place.sub || "", place: !!place.place, area: place.area || "", addr: place.addr || ""});
    if(favs.length > 12) favs.pop();
    toast("Als Favorit gespeichert");
  }
  try{ localStorage.setItem(FAV_KEY, JSON.stringify(favs)); }catch{}
  return idx < 0;
}

export function getHistory(){
  try{ return JSON.parse(localStorage.getItem(HIST_KEY)) || []; }catch{ return []; }
}

export function addHistory(place){
  if(!place || place.name === "Gewählter Punkt") return;
  let hist = getHistory().filter(h => !(h.name === place.name && Math.abs(h.lngLat[0]-place.lngLat[0]) < 0.0005));
  hist.unshift({name: place.name, lngLat: place.lngLat, sub: place.sub || "", place: !!place.place, area: place.area || "", addr: place.addr || ""});
  if(hist.length > 8) hist.pop();
  try{ localStorage.setItem(HIST_KEY, JSON.stringify(hist)); }catch{}
}

// Netzwerk-Status überwachen
export function initNetworkMonitor(){
  const banner = $("netStatus");
  const update = () => {
    banner.style.display = navigator.onLine ? "none" : "block";
  };
  window.addEventListener("online", () => { update(); toast("Verbindung wiederhergestellt"); });
  window.addEventListener("offline", update);
  update();
}
