/**
 * VS Code Theme Bridge
 *
 * Maps VS Code CSS variables onto Agentic Code Reviewer's CSS token names.
 */

const TOKEN_PAIRS: [string, string][] = [
  ["--vscode-editor-background", "--bg-canvas"],
  ["--vscode-sideBar-background", "--bg-panel"],
  ["--vscode-editorWidget-background", "--bg-elevated"],
  ["--vscode-input-background", "--bg-input"],
  ["--vscode-list-hoverBackground", "--bg-hover"],
  ["--vscode-list-activeSelectionBackground", "--bg-active"],
  ["--vscode-panel-border", "--border-default"],
  ["--vscode-widget-border", "--border-subtle"],
  ["--vscode-focusBorder", "--border-focus"],
  ["--vscode-editor-foreground", "--fg-default"],
  ["--vscode-foreground", "--fg-strong"],
  ["--vscode-descriptionForeground", "--fg-muted"],
  ["--vscode-disabledForeground", "--fg-disabled"],
  ["--vscode-button-background", "--accent"],
  ["--vscode-button-hoverBackground", "--accent-hover"],
  ["--vscode-focusBorder", "--accent-ring"],
  ["--vscode-errorForeground", "--sev-critical-fg"],
  ["--vscode-editorWarning-foreground", "--sev-high-fg"],
  ["--vscode-testing-iconPassed", "--status-ok-fg"],
];

export const VSCODE_VARS = [...new Set(TOKEN_PAIRS.map(([v]) => v))];

export function buildWrapperThemeScript(): string {
  const varsJson = JSON.stringify(VSCODE_VARS);
  return `<script>(function(){
  var vars=${varsJson};
  function readTheme(){
    var s=getComputedStyle(document.documentElement);
    var t={};
    for(var i=0;i<vars.length;i++){
      var v=s.getPropertyValue(vars[i]).trim();
      if(v)t[vars[i]]=v;
    }
    var kind=document.body.getAttribute("data-vscode-theme-kind")||"vscode-dark";
    return{type:"acr-vscode-theme",tokens:t,themeKind:kind};
  }
  function send(){
    var f=document.querySelector("iframe");
    if(!f||!f.contentWindow)return;
    var origin="*";
    try{origin=new URL(f.src).origin;}catch(e){}
    f.contentWindow.postMessage(readTheme(),origin);
  }
  window.addEventListener("load",function(){send();setTimeout(send,300);});
  var ob=new MutationObserver(function(){send();});
  ob.observe(document.documentElement,{attributes:true,attributeFilter:["style","class"]});
  ob.observe(document.body,{attributes:true,attributeFilter:["data-vscode-theme-kind"]});
})();</script>`;
}

export function buildThemeListenerScript(): string {
  const pairsJson = JSON.stringify(TOKEN_PAIRS);
  return `<script>(function(){
  window.__ACR_VSCODE=true;
  var pairs=${pairsJson};
  function rgbaFromHex(hex,alpha){
    if(!hex||hex[0]!=="#")return hex;
    var h=hex.slice(1);
    if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
    return"rgba("+r+","+g+","+b+","+alpha+")";
  }
  function adjustBrightness(color,amount){
    if(!color||color[0]!=="#")return null;
    var h=color.slice(1);
    if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var r=Math.min(255,Math.max(0,parseInt(h.slice(0,2),16)+amount));
    var g=Math.min(255,Math.max(0,parseInt(h.slice(2,4),16)+amount));
    var b=Math.min(255,Math.max(0,parseInt(h.slice(4,6),16)+amount));
    return"rgb("+r+","+g+","+b+")";
  }
  // Parent is a vscode-webview:// origin that cannot be enumerated ahead of
  // time, so validate the payload instead: only plain CSS color-ish values.
  var SAFE=/^[#a-zA-Z0-9(),.%\\s-]{1,64}$/;
  window.addEventListener("message",function(e){
    if(!e.data||e.data.type!=="acr-vscode-theme")return;
    var tokens={};
    var raw=e.data.tokens||{};
    for(var k in raw){
      if(typeof raw[k]==="string"&&SAFE.test(raw[k]))tokens[k]=raw[k];
    }
    var kind=e.data.themeKind;
    var root=document.documentElement;
    for(var i=0;i<pairs.length;i++){
      var val=tokens[pairs[i][0]];
      if(val)root.style.setProperty(pairs[i][1],val);
    }
    var accent=tokens["--vscode-button-background"]||tokens["--vscode-focusBorder"];
    if(accent){
      root.style.setProperty("--accent-soft",rgbaFromHex(accent,0.12));
      root.style.setProperty("--accent-ring",rgbaFromHex(accent,0.32));
    }
    var bg=tokens["--vscode-editor-background"];
    if(bg){
      var isDark=kind==="vscode-dark"||kind==="vscode-high-contrast";
      var card=adjustBrightness(bg,isDark?14:-14);
      if(card)root.style.setProperty("--bg-card",card);
    }
  });
})();</script>`;
}
