// The Help Centre has moved to the WordPress Support Centre. GitHub Pages
// cannot send a 301, so each faq page loads this first and sends the reader on.
// WordPress resolves these old URLs to the right page in one 301.
(function () {
  var base = "https://personalisationhub.com/support-centre/";
  var m = /\/(article|category|search)\.html$/.exec(location.pathname);
  location.replace(base + (m ? m[1] + ".html" : "") + location.search);
})();
