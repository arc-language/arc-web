(function(){
let _count=0;
const _el__a1=document.getElementById('_a1');
const _el__a4=document.getElementById('_a4');
function _set_count(v){
_count=v;
_el__a1.textContent=_count;
_el__a4.textContent=(_count*2);
}
(function(){const _ee=document.getElementById('_a2');if(_ee)_ee.addEventListener('click',function(event){_set_count(_count-(1));});})();
(function(){const _ee=document.getElementById('_a3');if(_ee)_ee.addEventListener('click',function(event){_set_count(_count+(1));});})();
_el__a1.textContent=_count;
_el__a4.textContent=(_count*2);
})();
//# sourceMappingURL=app.js.map