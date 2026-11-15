export const VALHALLA="https://valhalla1.openstreetmap.de/route";

export function decodePolyline(str){
  let i=0,lat=0,lon=0,out=[];
  while(i<str.length){
    let b,s=0,r=0;
    do{b=str.charCodeAt(i++)-63;r|=(b&31)<<s;s+=5}while(b>=32);
    lat+=(r&1)?~(r>>1):(r>>1);
    s=0;r=0;
    do{b=str.charCodeAt(i++)-63;r|=(b&31)<<s;s+=5}while(b>=32);
    lon+=(r&1)?~(r>>1):(r>>1);
    out.push([lon/1e6,lat/1e6]);
  }
  return out;
}

const rad=Math.PI/180;
export function dist(a,b){
  const dLa=(b[1]-a[1])*rad,dLo=(b[0]-a[0])*rad;
  const h=Math.sin(dLa/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dLo/2)**2;
  return 12742000*Math.asin(Math.sqrt(h));
}

export async function calculateRoute(startCoords, waypoints, destCoords){
  const pts = [startCoords, ...waypoints.map(w => w.lngLat), destCoords];
  const locations = pts.map((c, idx) => ({
    lat: c[1],
    lon: c[0],
    type: (idx === 0 || idx === pts.length - 1) ? "break" : "through"
  }));

  const body={
    locations,
    costing:"auto",
    directions_options:{language:"de-DE",units:"kilometers"}
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(VALHALLA+"?json="+encodeURIComponent(JSON.stringify(body)), {signal: controller.signal});
    if(!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    
    // Alle Legs zusammenführen (bei Zwischenstopps)
    let shape = [];
    let man = [];
    let offset = 0;
    j.trip.legs.forEach((leg, legIdx) => {
      const dec = decodePolyline(leg.shape);
      if (legIdx > 0 && dec.length > 0) dec.shift(); // doppelten Punkt vermeiden
      leg.maneuvers.forEach(m => {
        man.push({
          ...m,
          begin_shape_index: m.begin_shape_index + offset,
          end_shape_index: m.end_shape_index + offset
        });
      });
      shape = shape.concat(dec);
      offset = shape.length - 1;
    });

    const cum=[0];
    for(let i=1;i<shape.length;i++) cum[i]=cum[i-1]+dist(shape[i-1],shape[i]);

    return {
      shape,
      man,
      cum,
      tripTime: j.trip.summary.time,
      summary: j.trip.summary
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchPhoton(query, me){
  const u=new URL("https://photon.komoot.io/api/");
  u.search=new URLSearchParams({q:query,limit:6,lang:"de",...(me?{lat:me[1],lon:me[0]}:{})});
  const res = await fetch(u);
  if(!res.ok) throw new Error("Photon error");
  return (await res.json()).features || [];
}

export async function reversePhoton(lngLat){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),6000);
  try{
    const [lon,lat]=lngLat;
    const j=await(await fetch("https://photon.komoot.io/reverse?"+new URLSearchParams({lon,lat,lang:"de",limit:1}),{signal:c.signal})).json();
    const p=j.features&&j.features[0]&&j.features[0].properties;
    if(p) return [[p.postcode,p.city||p.town||p.village||p.locality||p.district||p.county].filter(Boolean).join(" "),p.state,p.country].filter(Boolean).join(", ");
  }catch{}finally{clearTimeout(t)}
  return "";
}

const OVP=["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter"];
export async function queryOverpass(q){
  const ctrls=[];
  const one=async u=>{
    const c=new AbortController();ctrls.push(c);const t=setTimeout(()=>c.abort(),7000);
    try{const r=await fetch(u+"?data="+encodeURIComponent(q),{signal:c.signal});if(!r.ok)throw new Error(r.status);return(await r.json()).elements}
    finally{clearTimeout(t)}
  };
  try{const r=await Promise.any(OVP.map(one));ctrls.forEach(c=>c.abort());return r}catch{return null}
}
