(function(){
  // Find our own <script> tag so we can read the data-site attribute.
  // document.currentScript is set by the browser while the script executes.
  var s=document.currentScript;
  if(!s)return;

  // The site's public tracking key, set via <script ... data-site="UUID">.
  var sk=s.getAttribute("data-site");
  if(!sk)return;

  // Derive the Humblebee server origin from the script's src URL.
  // e.g. "https://humblebee.example.com/hb.js" -> "https://humblebee.example.com"
  var base=s.src.replace(/\/hb\.js.*/,"");

  // -- Cookie helpers --

  // Read a cookie by name. Returns the value string or null.
  function gC(n){var m=document.cookie.match(new RegExp("(?:^|;\\s*)"+n+"=([^;]*)"));return m?decodeURIComponent(m[1]):null}

  // Set a cookie. n=name, v=value, d=max-age in seconds.
  function sC(n,v,d){var e="";if(d){var dt=new Date();dt.setTime(dt.getTime()+d*1000);e=";expires="+dt.toUTCString()}document.cookie=n+"="+encodeURIComponent(v)+e+";path=/;SameSite=Lax"}

  // Generate a v4 UUID using Math.random (no crypto dependency).
  function uid(){return"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(c){var r=Math.random()*16|0;return(c==="x"?r:r&3|8).toString(16)})}

  // -- User identity --

  // _hb_uid persists across sessions (1 year expiry). This is the visitor UUID.
  // If no cookie exists this is a brand new visitor -- generate and store one.
  var u=gC("_hb_uid");
  if(!u){u=uid();sC("_hb_uid",u,31536000)}

  // -- Session management --

  // _hb_sid is a rolling-expiry cookie. We also mirror the session ID into
  // sessionStorage so that internal navigations after the cookie has expired
  // don't incorrectly start a new session. sessionStorage is tab-scoped and
  // survives page navigations but not new tabs or browser restarts, so it
  // can't produce false continuity across genuine separate visits.
  var sid=gC("_hb_sid");
  var isNew=!sid;
  if(!sid){
    // Cookie expired. Check whether the user was still on this site (internal
    // navigation) by comparing the referrer origin to the current origin.
    var _stored=sessionStorage.getItem("_hb_sid");
    var _ref=document.referrer;
    var _sameOrigin=false;
    function _stripWww(o){return o.replace(/^(https?:\/\/)www\./,"$1")}
    try{_sameOrigin=_ref&&_stripWww(new URL(_ref).origin)===_stripWww(window.location.origin)}catch(e){}
    if(_stored&&_sameOrigin){
      // Internal navigation after idle timeout -- continue the existing session.
      sid=_stored;
      isNew=false;
    }else{
      sid=uid();
    }
  }
  // Keep sessionStorage in sync and refresh the cookie expiry.
  sessionStorage.setItem("_hb_sid",sid);
  sC("_hb_sid",sid,1800);

  // -- Send helper --

  // Sends an event to the collect endpoint. Used by both page views and custom events.
  function send(eventName,props){
    var p=location.pathname+location.search;
    var body=JSON.stringify({site_uuid:sk,uuid:u,session_id:sid,event_name:eventName,page_path:p,properties:props||null});
    fetch(base+"/api/collect",{method:"POST",body:body,headers:{"Content-Type":"application/json"}}).catch(function(){});
    sC("_hb_sid",sid,1800);
  }

  // -- Page view tracking --

  // Dedup map: prevents sending the same page_view twice in one page load.
  var sent={};

  function track(isNewSess){
    var p=location.pathname+location.search;
    var key=sid+"|"+p;
    if(sent[key])return;
    sent[key]=1;

    // On the first page view of a new session, capture the referrer.
    var props=null;
    if(isNewSess){
      var ref=document.referrer;
      props={referrer:ref||"direct"};
    }
    send("page_view",props);
  }

  // Fire immediately for the current page.
  track(isNew);

  // -- SPA support --

  // Monkey-patch history.pushState and replaceState so we detect client-side
  // navigation in single-page apps (React Router, Next.js, etc).
  var _push=history.pushState;
  var _replace=history.replaceState;
  history.pushState=function(){_push.apply(this,arguments);track(false)};
  history.replaceState=function(){_replace.apply(this,arguments);track(false)};

  // Also listen for popstate (browser back/forward buttons).
  window.addEventListener("popstate",function(){track(false)});

  // -- Custom events: humblebee.buzz() --

  // Expose a global so site owners can fire custom events from JS.
  // Usage: humblebee.buzz("signup")
  // The event name must be on the site's allowed_events list or the server rejects it.
  window.humblebee={
    buzz:function(eventName){
      if(typeof eventName==="string"&&eventName){
        send(eventName,null);
      }
    }
  };

  // -- HTML attribute events --

  // Scan the DOM for data-buzz-on-click and data-buzz-on-view attributes
  // and bind handlers automatically. Runs after DOM is ready.
  function bindBuzz(){
    // data-buzz-on-click: fires the event when the element is clicked.
    var clicks=document.querySelectorAll("[data-buzz-on-click]");
    for(var i=0;i<clicks.length;i++){
      (function(el){
        var ev=el.getAttribute("data-buzz-on-click");
        if(!ev)return;
        el.addEventListener("click",function(){send(ev,null)});
      })(clicks[i]);
    }

    // data-buzz-on-view: fires the event when the element enters the viewport.
    // Uses IntersectionObserver for efficiency. Each element only fires once.
    var views=document.querySelectorAll("[data-buzz-on-view]");
    if(views.length&&window.IntersectionObserver){
      var obs=new IntersectionObserver(function(entries){
        for(var j=0;j<entries.length;j++){
          if(entries[j].isIntersecting){
            var ev=entries[j].target.getAttribute("data-buzz-on-view");
            if(ev)send(ev,null);
            obs.unobserve(entries[j].target);
          }
        }
      },{threshold:0.5});
      for(var k=0;k<views.length;k++){
        obs.observe(views[k]);
      }
    }
  }

  // Bind after DOM is ready.
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",bindBuzz);
  }else{
    bindBuzz();
  }
})();
