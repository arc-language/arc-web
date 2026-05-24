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
(function(){const _ee=document.getElementById('_a5');if(_ee)_ee.addEventListener('click',function(event){_set_activeTab("overview");});})();
(function(){const _ee=document.getElementById('_a6');if(_ee)_ee.addEventListener('click',function(event){_set_activeTab("analytics");});})();
_el__a1.textContent=user.name;
_el__a2.textContent=stats.users;
_el__a3.textContent=stats.posts;
_el__a4.textContent=stats.revenue;
_el__a7.textContent=_activeTab;
})();
//# sourceMappingURL=app.js.map