// ADP mini-runtime (auto-generated)
function _adpEncode(v){const b=[];function w(x){if(x===null||x===undefined){b.push(0);}else if(x===true){b.push(1);}else if(x===false){b.push(2);}else if(typeof x==='number'){if(Number.isInteger(x)&&x>=0&&x<=255){b.push(3,x);}else if(Number.isInteger(x)){b.push(4,(x>>>24)&255,(x>>>16)&255,(x>>>8)&255,x&255);}else{b.push(5);const d=new DataView(new ArrayBuffer(8));d.setFloat64(0,x,false);for(let i=0;i<8;i++)b.push(d.getUint8(i));}}else if(typeof x==='string'){b.push(6);const e=new TextEncoder().encode(x);let l=e.length;while(l>127){b.push((l&127)|128);l>>>=7;}b.push(l);e.forEach(c=>b.push(c));}else if(Array.isArray(x)){b.push(7);let l=x.length;while(l>127){b.push((l&127)|128);l>>>=7;}b.push(l);x.forEach(w);}else if(typeof x==='object'){const ks=Object.keys(x);b.push(8);let l=ks.length;while(l>127){b.push((l&127)|128);l>>>=7;}b.push(l);ks.forEach(k=>{const e=new TextEncoder().encode(k);let kl=e.length;while(kl>127){b.push((kl&127)|128);kl>>>=7;}b.push(kl);e.forEach(c=>b.push(c));w(x[k]);});}}w(v);return new Uint8Array(b);}
function _adpDecode(buf){let p=0;function rv(){const t=buf[p++];if(t===0)return null;if(t===1)return true;if(t===2)return false;if(t===3)return buf[p++];if(t===4){const v=(buf[p]<<24)|(buf[p+1]<<16)|(buf[p+2]<<8)|buf[p+3];p+=4;return v;}if(t===5){const d=new DataView(buf.buffer,buf.byteOffset+p,8);p+=8;return d.getFloat64(0,false);}if(t===6){let l=0,s=0;while(true){const b=buf[p++];l|=(b&127)<<s;if(!(b&128))break;s+=7;}return new TextDecoder().decode(buf.subarray(p,p+=l));}if(t===7){let l=0,s=0;while(true){const b=buf[p++];l|=(b&127)<<s;if(!(b&128))break;s+=7;}return Array.from({length:l},rv);}if(t===8){let l=0,s=0;while(true){const b=buf[p++];l|=(b&127)<<s;if(!(b&128))break;s+=7;}const o={};for(let i=0;i<l;i++){let kl=0,ks=0;while(true){const b=buf[p++];kl|=(b&127)<<ks;if(!(b&128))break;ks+=7;}const k=new TextDecoder().decode(buf.subarray(p,p+=kl));o[k]=rv();}return o;}throw new Error('ADP: unknown tag '+t);}return rv();}
async function getUser(id) {
  const _res = await fetch('/_arc/fn/getUser', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-adp'},
    body: _adpEncode({id})
  })
  if (!_res.ok) throw new Error(await _res.text())
  const _buf = await _res.arrayBuffer()
  return _adpDecode(new Uint8Array(_buf))
}
async function getStats() {
  const _res = await fetch('/_arc/fn/getStats', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-adp'},
    body: _adpEncode(null)
  })
  if (!_res.ok) throw new Error(await _res.text())
  const _buf = await _res.arrayBuffer()
  return _adpDecode(new Uint8Array(_buf))
}
(function(){
let _activeTab="overview";
const _el__a1=document.getElementById('_a1');
const _el__a2=document.getElementById('_a2');
const _el__a3=document.getElementById('_a3');
const _el__a4=document.getElementById('_a4');
const _el__a7=document.getElementById('_a7');
function _set_activeTab(v){
_activeTab=v;
_el__a7.textContent=_activeTab;
}
document.getElementById('_a5').addEventListener('click',function(event){_set_activeTab("overview");});
document.getElementById('_a6').addEventListener('click',function(event){_set_activeTab("analytics");});
_el__a1.textContent=user.name;
_el__a2.textContent=stats.users;
_el__a3.textContent=stats.posts;
_el__a4.textContent=stats.revenue;
_el__a7.textContent=_activeTab;
})();
//# sourceMappingURL=app.js.map