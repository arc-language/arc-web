widget CmsEditBar(pageId: String, pageTitle: String, published: Bool = false)
  @raw `<style>
#cms-edit-bar{position:fixed;top:0;left:0;right:0;z-index:99999;height:48px;display:flex;align-items:center;gap:12px;padding:0 16px;background:linear-gradient(170deg,color-mix(in oklch,var(--brand-from,oklch(78% 0.16 220)),transparent 88%) 0%,color-mix(in oklch,oklch(13% 0.02 270),transparent 96%) 50%,color-mix(in oklch,var(--brand-to,oklch(55% 0.24 295)),transparent 90%) 100%);backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);box-shadow:0 1px 0 rgba(255,255,255,0.08),0 2px 12px rgba(0,0,16,0.4);font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;font-size:13px;color:#fff;box-sizing:border-box;}
#cms-edit-bar .ceb-brand{font-weight:700;letter-spacing:-0.01em;opacity:0.9;flex-shrink:0;}
#cms-edit-bar .ceb-sep{width:1px;height:18px;background:rgba(255,255,255,0.15);flex-shrink:0;}
#cms-edit-bar .ceb-title{opacity:0.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;}
#cms-edit-bar .ceb-draft{font-size:11px;font-weight:600;padding:2px 7px;border-radius:4px;background:rgba(255,200,0,0.2);color:#fcd34d;letter-spacing:0.04em;text-transform:uppercase;flex-shrink:0;}
#cms-edit-bar .ceb-back{color:rgba(255,255,255,0.65);text-decoration:none;font-weight:500;flex-shrink:0;}
#cms-edit-bar .ceb-back:hover{color:#fff;}
#cms-edit-bar .ceb-back:focus-visible{outline:2px solid #fff;outline-offset:3px;border-radius:3px;}
#cms-edit-bar .ceb-space{flex:1;}
#cms-edit-bar .ceb-status{font-size:12px;opacity:0.6;transition:opacity 0.2s,color 0.2s;}
#cms-edit-bar .ceb-status.ok{opacity:1;color:#4ade80;}
#cms-edit-bar .ceb-status.err{opacity:1;color:#f87171;}
#cms-edit-bar .ceb-publish{padding:5px 14px;border-radius:7px;border:none;background:rgba(255,255,255,0.15);color:#fff;font-size:12px;font-weight:600;cursor:pointer;transition:background 0.15s;flex-shrink:0;}
#cms-edit-bar .ceb-publish:hover{background:rgba(255,255,255,0.25);}
#cms-edit-bar .ceb-publish:focus-visible{outline:2px solid rgba(255,255,255,0.5);outline-offset:3px;}
#cms-edit-bar .ceb-publish.published{background:rgba(74,222,128,0.2);color:#4ade80;}
</style>`

  div id="cms-edit-bar" data-cms-page="{pageId}"
    span class="ceb-brand" "◈ arc cms"
    div class="ceb-sep"
    span class="ceb-title" title="{pageTitle}" "{pageTitle}"
    if !published
      span class="ceb-draft" "Draft"
    link href="/admin/pages/{pageId}" class="ceb-back" "← Admin"
    div class="ceb-space"
    span class="ceb-status" id="cms-status" aria-live="polite" aria-atomic="true"
    button class="ceb-publish{published ? ' published' : ''}" id="cms-publish-btn" "{published ? '✓ Published' : 'Publish'}"

  @raw `<script>
(function(){
  function _initCmsEditor(){
    var bar=document.getElementById("cms-edit-bar");
    if(!bar||bar.closest("[hidden]"))return false;
    var _existPad=parseInt(getComputedStyle(document.body).paddingTop)||0;
    document.body.style.paddingTop=(_existPad+48)+"px";
    var PAGE_ID=bar.dataset.cmsPage;
  var dirty={};
  var flushing=false;
  var flushTimer=null;
  var flushPromise=null;
  var status=document.getElementById("cms-status");
  function setStatus(msg,cls){status.textContent=msg;status.className="ceb-status"+(cls?" "+cls:"");if(cls==="ok")setTimeout(function(){status.textContent="";status.className="ceb-status";},2500);}
  function scheduleFlush(){clearTimeout(flushTimer);flushTimer=setTimeout(flush,700);}
  async function flush(){
    if(!Object.keys(dirty).length||flushing)return;
    flushing=true;
    setStatus("Saving…");
    var snapshot=dirty;dirty={};var ok=true;
    try{flushPromise=Promise.all(Object.entries(snapshot).map(function(kv){var key=kv[0],p=kv[1];return fetch("/admin/api/blocks/"+p.blockId+"/field",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({field:p.field,value:p.value,itemIndex:p.itemIndex})}).then(function(r){if(!r.ok){dirty[key]=p;ok=false;}}).catch(function(){dirty[key]=p;ok=false;});}));await flushPromise;}finally{flushing=false;flushPromise=null;}
    setStatus(ok?"Saved ✓":"Error saving",ok?"ok":"err");
  }
  document.querySelectorAll("[data-cms-block]").forEach(function(block){
    var blockId=block.getAttribute("data-cms-block");
    var itemEls=Array.from(block.querySelectorAll("[data-cms-item]"));
    block.querySelectorAll("[data-cms-field]").forEach(function(el){
      var field=el.getAttribute("data-cms-field");
      var itemEl=el.closest("[data-cms-item]");
      var itemIndex=itemEl?itemEls.indexOf(itemEl):undefined;
      if(itemIndex===-1)itemIndex=undefined;
      var isUrl=field==="ctaHref"||field==="buttonHref";
      var isMultiline=field==="body"||field==="answer";
      if(isUrl){
        el.style.cursor="pointer";
        el.addEventListener("mouseover",function(){el.style.outline="2px dashed rgba(92,143,255,0.7)";el.style.outlineOffset="3px";});
        el.addEventListener("mouseout",function(){if(document.activeElement!==el)el.style.outline="";});
        el.addEventListener("click",function(e){e.preventDefault();var cur=el.getAttribute("href")||"";var val=prompt("Enter URL:",cur);if(val!==null){var v=val.trim();if(v&&!/^(https?:\/\/|\/|#)/.test(v)){alert("URL must start with https://, http://, / or #");return;}el.setAttribute("href",v);var key=blockId+"."+field+(itemIndex!==undefined?"."+itemIndex:"");dirty[key]={blockId:blockId,field:field,value:v,itemIndex:itemIndex};scheduleFlush();}});
        return;
      }
      el.style.cursor="text";
      el.addEventListener("mouseover",function(){if(document.activeElement!==el){el.style.outline="2px solid rgba(92,143,255,0.6)";el.style.outlineOffset="3px";}});
      el.addEventListener("mouseout",function(){if(document.activeElement!==el)el.style.outline="";});
      var escaping=false;
      el.addEventListener("click",function(e){e.stopPropagation();el._origVal=el.textContent;el.contentEditable="true";el.style.outline="2px solid rgba(92,143,255,1)";el.focus();});
      el.addEventListener("blur",function(){el.contentEditable="false";el.style.outline="";if(escaping){escaping=false;return;}var val=isMultiline?el.textContent:el.textContent.replace(/[\r\n]/g,"");if(el._origVal!==undefined&&val===el._origVal)return;var key=blockId+"."+field+(itemIndex!==undefined?"."+itemIndex:"");dirty[key]={blockId:blockId,field:field,value:val,itemIndex:itemIndex};scheduleFlush();});
      el.addEventListener("keydown",function(e){if(!isMultiline&&e.key==="Enter"){e.preventDefault();el.blur();}if(e.key==="Escape"){escaping=true;el.textContent=el._origVal!==undefined?el._origVal:el.textContent;el.blur();}});
    });
  });
  document.querySelectorAll("[data-cms-block] [data-cms-field='source']").forEach(function(pre){
    var block=pre.closest("[data-cms-block]");
    var blockId=block.getAttribute("data-cms-block");
    pre.setAttribute("role","button");pre.setAttribute("tabindex","0");pre.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();pre.click();}});
    pre.addEventListener("click",function(){
      var lang=pre.getAttribute("data-cms-lang")||"js";
      var cur=(pre.querySelector("code")||{}).textContent||"";
      var _trigger=pre;
      var overlay=document.createElement("div");overlay.style.cssText="position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;";overlay.setAttribute("role","dialog");overlay.setAttribute("aria-modal","true");overlay.setAttribute("aria-label","Edit code");
      var box=document.createElement("div");box.style.cssText="background:#0d1117;border-radius:12px;padding:20px;width:min(800px,90vw);display:flex;flex-direction:column;gap:12px;";
      var label=document.createElement("div");label.style.cssText="color:#e6edf3;font-size:13px;font-weight:600;";label.textContent="Edit code ("+lang+")";
      var ta=document.createElement("textarea");ta.value=cur;ta.style.cssText="width:100%;height:280px;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:12px;font-family:ui-monospace,'SF Mono',Consolas,monospace;font-size:13px;line-height:1.6;resize:vertical;box-sizing:border-box;";ta.spellcheck=false;ta.setAttribute("autocorrect","off");ta.setAttribute("autocapitalize","off");ta.setAttribute("autocomplete","off");
      var btns=document.createElement("div");btns.style.cssText="display:flex;gap:8px;justify-content:flex-end;";
      var cancel=document.createElement("button");cancel.textContent="Cancel";cancel.style.cssText="padding:6px 14px;border-radius:7px;border:none;background:rgba(255,255,255,0.1);color:#e6edf3;cursor:pointer;font-size:13px;";
      var save=document.createElement("button");save.textContent="Save";save.style.cssText="padding:6px 14px;border-radius:7px;border:none;background:rgba(92,143,255,0.8);color:#fff;cursor:pointer;font-size:13px;font-weight:600;";
      cancel.onclick=function(){document.body.removeChild(overlay);_trigger.focus();};
      overlay.addEventListener("keydown",function(e){if(e.key==="Escape")cancel.onclick();});
      save.onclick=function(){var val=ta.value;var codeEl=pre.querySelector("code");if(codeEl)codeEl.textContent=val;dirty[blockId+".source"]={blockId:blockId,field:"source",value:val};scheduleFlush();document.body.removeChild(overlay);_trigger.focus();};
      btns.appendChild(cancel);btns.appendChild(save);box.appendChild(label);box.appendChild(ta);box.appendChild(btns);overlay.appendChild(box);document.body.appendChild(overlay);ta.focus();
    });
  });
  document.getElementById("cms-publish-btn").addEventListener("click",async function(){
    var btn=this;btn.disabled=true;setStatus("Publishing…");
    try{if(flushPromise)await flushPromise;await flush();if(Object.keys(dirty).length){setStatus("Some edits failed to save","err");return;}
    var res=await fetch("/admin/pages/"+PAGE_ID+"/publish",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({published:true})});
    if(res.ok){setStatus("Published ✓","ok");btn.textContent="✓ Published";btn.className="ceb-publish published";}else{setStatus("Publish failed","err");}}catch(e){setStatus("Publish failed","err");}finally{btn.disabled=false;}
  });
  return true;
  }
  // Arc hydrates the page async after DOMContentLoaded. Use a MutationObserver to
  // detect when the hidden ancestor is removed (i.e. the edit bar becomes visible).
  var _ob=new MutationObserver(function(){if(document.getElementById("cms-edit-bar")&&!document.getElementById("cms-edit-bar").closest("[hidden]")){_ob.disconnect();_initCmsEditor();}});
  document.addEventListener("DOMContentLoaded",function(){if(!_initCmsEditor()){_ob.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:["hidden"],childList:true});}});
  window.addEventListener("pagehide",function(){_ob.disconnect();});
})();
</script>`

  design
    #cms-edit-bar
      display: flex
      align-items: center
