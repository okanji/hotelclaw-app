/**
 * hotelclaw chatbot embed widget.
 *
 * Usage (paste before </body> on the hotel's website):
 *   <script src="https://<app-host>/chatbot-widget.js"
 *           data-chatbot="<public slug>"
 *           data-color="#c96442"   (optional accent)
 *           async></script>
 *
 * Renders a floating bubble that toggles an iframe of the bot's hosted
 * guest page (/g/<slug>). All chat traffic stays same-origin inside the
 * iframe — no CORS surface. The app only allows framing from the domains
 * listed in the bot's Deploy settings (frame-ancestors CSP), so a leaked
 * snippet doesn't work elsewhere.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var slug = script.getAttribute("data-chatbot");
  if (!slug) return;
  var color = script.getAttribute("data-color") || "#c96442";
  var origin = new URL(script.src).origin;
  var chatUrl = origin + "/g/" + encodeURIComponent(slug) + "?embed=1";

  var open = false;

  var frameWrap = document.createElement("div");
  frameWrap.style.cssText =
    "position:fixed;z-index:2147483646;bottom:88px;right:16px;width:380px;height:min(600px,calc(100vh - 110px));" +
    "max-width:calc(100vw - 32px);border-radius:16px;overflow:hidden;display:none;" +
    "box-shadow:0 12px 40px rgba(0,0,0,.22);background:#faf7f1;";

  var iframe = document.createElement("iframe");
  iframe.title = "Chat with us";
  iframe.allow = "clipboard-write";
  iframe.style.cssText = "width:100%;height:100%;border:0;";
  // src set lazily on first open so the page doesn't pay for hidden widgets.
  frameWrap.appendChild(iframe);

  var button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Chat with us");
  button.style.cssText =
    "position:fixed;z-index:2147483647;bottom:16px;right:16px;width:56px;height:56px;border:0;border-radius:50%;" +
    "cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.25);" +
    "background:" + color + ";transition:transform .15s ease;";
  button.onmouseenter = function () { button.style.transform = "scale(1.06)"; };
  button.onmouseleave = function () { button.style.transform = "scale(1)"; };

  var chatIcon =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var closeIcon =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  button.innerHTML = chatIcon;

  button.onclick = function () {
    open = !open;
    if (open && !iframe.src) iframe.src = chatUrl;
    frameWrap.style.display = open ? "block" : "none";
    button.innerHTML = open ? closeIcon : chatIcon;
    // Phones: take the full viewport while open.
    if (open && window.innerWidth < 480) {
      frameWrap.style.cssText +=
        "top:0;left:0;right:0;bottom:0;width:100%;height:100%;max-width:none;border-radius:0;";
    }
  };

  document.body.appendChild(frameWrap);
  document.body.appendChild(button);
})();
