'use strict';
// Page-context scripts injected on demand (reader mode, picture-in-picture).

const READER = `(function(){
  var ID='__kitsune_reader';
  var old=document.getElementById(ID);
  if(old){old.remove();document.documentElement.style.overflow='';return 'off';}
  var scores=new Map();
  function add(el,v){if(!el||el===document.documentElement)return;scores.set(el,(scores.get(el)||0)+v);}
  document.querySelectorAll('p').forEach(function(p){
    var t=(p.textContent||'').trim(); if(t.length<50)return;
    var s=1+(t.split(',').length-1)+Math.min(Math.floor(t.length/100),3);
    add(p.parentElement,s); if(p.parentElement)add(p.parentElement.parentElement,s/2);
  });
  var best=null,bs=0;
  scores.forEach(function(v,el){
    var links=el.querySelectorAll('a').length, txt=(el.textContent||'').length||1;
    var density=Array.prototype.reduce.call(el.querySelectorAll('a'),function(a,x){return a+(x.textContent||'').length;},0)/txt;
    var s=v*(1-Math.min(density,0.9)); if(s>bs){bs=s;best=el;}
  });
  var art=document.querySelector('article'); if(art&&art.querySelectorAll('p').length>=3)best=art;
  if(!best||bs<5&&!art){return 'none';}
  var clone=best.cloneNode(true);
  clone.querySelectorAll('script,style,nav,aside,form,iframe,button,noscript,svg,[aria-hidden=true],[class*=advert],[id*=advert],[class*=share],[class*=social],[class*=related],[class*=comment]').forEach(function(n){n.remove();});
  clone.querySelectorAll('*').forEach(function(n){n.removeAttribute('style');n.removeAttribute('class');n.removeAttribute('id');n.removeAttribute('onclick');});
  var h1=document.querySelector('h1'); var title=(h1&&h1.textContent.trim())||document.title;
  var words=(clone.textContent||'').trim().split(/\\s+/).length;
  var host=document.createElement('div'); host.id=ID;
  host.style.cssText='position:fixed;inset:0;z-index:2147483647;overflow:auto;';
  var root=host.attachShadow({mode:'open'});
  root.innerHTML='<style>'+
   ':host{all:initial}.wrap{min-height:100%;transition:background .3s,color .3s;font-family:Georgia,"Iowan Old Style","Noto Serif",serif}'+
   '.wrap.light{background:#fbfaf7;color:#222}.wrap.sepia{background:#f3e8d0;color:#4a3a22}.wrap.dark{background:#15131b;color:#dcd7e8}'+
   'article{max-width:700px;margin:0 auto;padding:72px 24px 120px;font-size:var(--fs,20px);line-height:1.75;animation:in .5s ease both}'+
   '@keyframes in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}'+
   'h1{font-size:1.9em;line-height:1.2;margin:0 0 .3em}.meta{opacity:.6;font:14px system-ui,sans-serif;margin-bottom:2em}'+
   'img{max-width:100%;height:auto;border-radius:10px;margin:1em 0}a{color:#c0457a}pre,code{background:rgba(127,127,127,.15);padding:2px 6px;border-radius:6px;overflow:auto}'+
   'blockquote{border-left:3px solid #e07aa6;margin:1.2em 0;padding:.1em 1em;opacity:.85}'+
   '.bar{position:fixed;top:14px;right:18px;display:flex;gap:6px;font:600 13px system-ui,sans-serif;z-index:2}'+
   '.bar button{all:unset;cursor:pointer;padding:7px 12px;border-radius:999px;background:rgba(127,127,127,.18);backdrop-filter:blur(8px);transition:transform .15s,background .15s}'+
   '.bar button:hover{transform:translateY(-2px);background:rgba(224,122,166,.4)}'+
   '</style><div class="wrap light"><div class="bar"><button data-a="-">A−</button><button data-a="+">A+</button><button data-t="light">Light</button><button data-t="sepia">Sepia</button><button data-t="dark">Dark</button><button data-a="x">✕</button></div>'+
   '<article><h1></h1><div class="meta"></div><div class="body"></div></article></div>';
  root.querySelector('h1').textContent=title;
  root.querySelector('.meta').textContent=location.hostname+' · '+Math.max(1,Math.round(words/220))+' min read';
  root.querySelector('.body').appendChild(clone);
  var wrap=root.querySelector('.wrap'),fs=20;
  root.addEventListener('click',function(e){
    var b=e.target.closest('button'); if(!b)return;
    if(b.dataset.t){wrap.className='wrap '+b.dataset.t;}
    if(b.dataset.a==='+'){fs=Math.min(32,fs+2);wrap.style.setProperty('--fs',fs+'px');}
    if(b.dataset.a==='-'){fs=Math.max(14,fs-2);wrap.style.setProperty('--fs',fs+'px');}
    if(b.dataset.a==='x'){host.remove();document.documentElement.style.overflow='';}
  });
  document.documentElement.style.overflow='hidden';
  document.documentElement.appendChild(host);
  return 'on';
})()`;

const PIP = `(function(){
  if(document.pictureInPictureElement){document.exitPictureInPicture();return 'off';}
  var v=Array.prototype.slice.call(document.querySelectorAll('video')).filter(function(x){return x.readyState>0&&!x.disablePictureInPicture;});
  v.sort(function(a,b){return (b.videoWidth*b.videoHeight)-(a.videoWidth*a.videoHeight);});
  if(!v[0])return 'none';
  v[0].requestPictureInPicture();return 'on';
})()`;

module.exports = { READER, PIP };
