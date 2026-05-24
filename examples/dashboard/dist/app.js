(function(){
let _count=0;
const _el__a1=document.getElementById('_a1');
function _set_count(v){
_count=v;
_el__a1.textContent=_count;
}
(function(){const _ee=document.getElementById('_a2');if(_ee)_ee.addEventListener('click',function(event){_set_count(_count-(1));});})();
(function(){const _ee=document.getElementById('_a3');if(_ee)_ee.addEventListener('click',function(event){_set_count(_count+(1));});})();
_el__a1.textContent=_count;
})();
//# sourceMappingURL=app.js.map