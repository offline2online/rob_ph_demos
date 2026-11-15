<?php
/**
 * Interactive product tour (telco, pharmacy, retail media and fuel & convenience: one shared page, the path picks the industry).
 *
 * - GET /industries/telco/tour/, /industries/pharmacy/tour/, /industries/retail-media/tour/ and /industries/convenience/tour/ (with or without the trailing slash): the same tour page, served same-origin so the industry
 *   page can frame it (`?embed=1`). The HTML is tour-page.php (generated from tour/tour.html by tools/build-tour.mjs) when deployed; otherwise a sha256-pinned copy, see tour_page(). Answered at template_redirect
 *   priority 0 so redirect_canonical never sees it.
 * - GET /industries/retail-media/tour/assets/v1/{img|vo}/<file>: the retail media walkthrough's screenshots and voiceover, same-origin (no third-party request from a visitor). Allow-list TOUR_ASSETS
 *   (generated from tour-assets/retail-media/SHA256SUMS on tag tour-assets-retail-media-v1); served from a file cache in uploads, filled from the tag and checked by sha256; single byte ranges answer 206.
 * - GET /run-your-own-rmn/tour/ and /run-your-own-rmn/tour/assets/v4/{img|vo}/<file> (v4, 15 Nov 2026: clubs with 2 to 16 screens, each with its own mix of types; v1 to v3 still served): the Run Your Own RMN walkthrough
 *   (an operator, the Fairlinks Golf Network, sells the screens of its 100 golf clubs to a golf manufacturer, Corvane Golf; flow 3 is one club, Fernhollow Golf Club). Same page and route; its assets live in the repo as base64 text (tour-assets/rmn-golf/<dir>/<file>.b64),
 *   are fetched once, decoded and checked against TOUR_ASSETS_RMN_V4 (from tour-assets/rmn-golf/v4/SHA256SUMS, the decoded files) before they are cached in uploads.
 *   While the Run Your Own RMN page is hidden (OPERATOR_LIVE false) its tour is noindex like every tour and is left out of llms.txt and the twins (ai_tours()).
 * - POST ph-site/v1/tour-lead: the tour's gate form. Shaped like telco-model: honeypot, throttle, private ph_lead post, `ph_lead_captured`.
 *   No nonce: the page is edge-cached, so a stale wp_rest nonce would 403 anonymous callers (PH_TOUR.nonce is "").
 * - POST ph-site/v1/tour-brand: the visitor's company logos for the walkthrough, from the console (key stays on the server), see tour_brand_handle().
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const TOUR_SOURCE = 'interactive-product-tour';
const TOUR_FLOWS  = array( 'Campaign creation', 'Localisation & scheduling', 'Personalisation', 'Retailer setup', 'Advertiser creates by talking', 'Shopper journey & outcome', 'Fuel & convenience walkthrough', 'Venue setup', 'Network setup', 'Member journey & outcome' );
/** The three demos, as the tour's own gate lists them (GFLOWS in tour/tour.html): name and what it shows. Agent-facing text (twins, llms.txt) is generated from these. */
const TOUR_DEMOS_STD = array(
	array( 'Campaign creation', 'Talk a campaign into existence, in your brand.' ),
	array( 'Localisation & scheduling', 'Every store gets its own version.' ),
	array( 'Personalisation', 'The right offer the moment they check in.' ),
);
const TOUR_DEMOS_RM = array(
	array( 'Retailer setup', 'Open slots to brands and sell them through a deal.' ),
	array( 'Advertiser creates by talking', 'A whole campaign from a spoken brief.' ),
	array( 'Shopper journey & outcome', 'One shopper, four screens.' ),
);
const TOUR_DEMOS_RMN = array(
	array( 'Network setup', 'A golf network opens the screens at its 100 clubs to a brand through one deal.' ),
	array( 'Advertiser creates by talking', 'A whole campaign from a spoken brief, run across the network.' ),
	array( 'Member journey & outcome', 'One member at one club on the network, then the network\'s results.' ),
);
/** Industries the tour serves: key = the `industry` the tour sends; path = where the page is served; page = the industry page the lead came from; demos = the three demos. */
const TOUR_INDUSTRIES = array(
	'telco'    => array( 'name' => 'Telco', 'path' => '/industries/telco/tour', 'page' => '/industries/telco/', 'label' => 'Interactive product tour – Telco', 'demos' => TOUR_DEMOS_STD ),
	'pharmacy' => array( 'name' => 'Pharmacy', 'path' => '/industries/pharmacy/tour', 'page' => '/industries/pharmacy/', 'label' => 'Interactive product tour – Pharmacy', 'demos' => TOUR_DEMOS_STD ),
	'retail-media' => array( 'name' => 'Retail Media', 'path' => '/industries/retail-media/tour', 'page' => '/industries/retail-media/', 'label' => 'Interactive product tour – Retail Media', 'demos' => TOUR_DEMOS_RM ),
	'convenience' => array( 'name' => 'Fuel & Convenience', 'path' => '/industries/convenience/tour', 'page' => '/industries/convenience/', 'label' => 'Interactive product tour – Fuel & Convenience', 'demos' => TOUR_DEMOS_STD ),
	/* The Run Your Own RMN page's own tour (operator.php OPERATOR_TOUR_PATH). 'operator' => true: listed for agents only once that page is live (ai_tours()). */
	'rmn' => array( 'name' => 'Run Your Own RMN', 'path' => '/run-your-own-rmn/tour', 'page' => '/run-your-own-rmn/', 'label' => 'Interactive product tour – Run Your Own RMN', 'demos' => TOUR_DEMOS_RMN, 'operator' => true ),
);

/**
 * Pinned copy of the tour page, used when tour-page.php is not deployed (it is 200 KB, too big for the deploy MCP's inline file
 * writes). The URL follows main; the sha256 is the pin, so the content is guaranteed whatever the URL serves. To update the tour,
 * merge it, then change TOUR_PAGE_SHA256 to the new tour.html's sha256; a changed sha refetches by itself. GitHub's raw CDN can serve the
 * previous main for a few minutes after a merge: until the fetched copy matches, the last good cached copy is served.
 */
const TOUR_PAGE_OPTION  = 'ph_tour_page_html';
const TOUR_PAGE_BACKOFF = 'ph_tour_page_backoff';
const TOUR_PAGE_SHA256  = 'cb084b81c954a3728ef45d8638ddb793a8fae83d7253dc450e6fefd1c568fea0';
const TOUR_PAGE_URL     = 'https://raw.githubusercontent.com/offline2online/rob_ph_demos/main/ph-website/snippets/ph-industry-enhancements/tour/tour.html';

/**
 * The tour page HTML. Returns array( html|null, reason ). Order: tour-page.php next to this file; the cached option when its sha
 * matches TOUR_PAGE_SHA256; then the pinned URL (accepted only on a 200 whose sha256 matches; only then stored). When the fetch
 * fails or does not match, a 5-minute back-off transient stops further fetches, and an older cached copy (intact against its own sha)
 * is served with 200 and the reason returned for logging. With nothing cached the html is null and the route answers 503.
 */
function tour_page() {
	if ( file_exists( __DIR__ . '/tour-page.php' ) ) {
		return array( data( 'tour-page.php' ), '' );
	}
	$cached = get_option( TOUR_PAGE_OPTION );
	$intact = is_array( $cached ) && isset( $cached['sha'], $cached['html'] ) && is_string( $cached['html'] ) && '' !== $cached['html'] && hash( 'sha256', $cached['html'] ) === $cached['sha'];
	if ( $intact && TOUR_PAGE_SHA256 === $cached['sha'] ) {
		return array( $cached['html'], '' );
	}
	$why = '';
	if ( false !== get_transient( TOUR_PAGE_BACKOFF ) ) {
		$why = 'fetch skipped, backing off after an earlier failure';
	} else {
		$res = wp_remote_get( TOUR_PAGE_URL, array( 'timeout' => 10 ) );
		if ( is_wp_error( $res ) ) {
			$why = 'fetch failed: ' . $res->get_error_message();
		} elseif ( 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
			$why = 'fetch answered ' . (int) wp_remote_retrieve_response_code( $res );
		} else {
			$body = (string) wp_remote_retrieve_body( $res );
			if ( hash( 'sha256', $body ) === TOUR_PAGE_SHA256 ) {
				update_option( TOUR_PAGE_OPTION, array( 'sha' => TOUR_PAGE_SHA256, 'html' => $body ), false );
				return array( $body, '' );
			}
			$why = 'fetched copy does not match TOUR_PAGE_SHA256';
		}
		set_transient( TOUR_PAGE_BACKOFF, 1, 5 * MINUTE_IN_SECONDS );
	}
	if ( $intact ) {
		return array( $cached['html'], $why . '; serving the cached copy' );
	}
	return array( null, $why );
}

/**
 * Retail media walkthrough assets. Allow-list: name (dir/file) => array( sha256, bytes ), generated from tour-assets/retail-media/SHA256SUMS at the tag below.
 * The files are not in the snippet (6 MB, binary): they live on the tag, are fetched once into uploads/ph-tour/retail-media/v1/ and served from there. v1 is immutable; changed assets need a v2 tag, route and map.
 */
const TOUR_ASSET_PREFIX  = '/industries/retail-media/tour/assets/v1/';
const TOUR_ASSET_TAG_URL = 'https://raw.githubusercontent.com/offline2online/rob_ph_demos/tour-assets-retail-media-v1/ph-website/tour-assets/retail-media/';
const TOUR_ASSET_MIRROR_URL = 'https://cdn.jsdelivr.net/gh/offline2online/rob_ph_demos@tour-assets-retail-media-v1/ph-website/tour-assets/retail-media/';
const TOUR_ASSET_BACKOFF = 'ph_tour_asset_backoff_';
const TOUR_ASSETS = array(
	'img/01-advertiser.jpg' => array( 'c9f334655842f66229649d7667029a2a3e295ab79ee7554f21baf602b3a427e1', 142697 ),
	'img/03-users.jpg' => array( 'e6ec4b609a6cf1e54e2c4efe43fd6499e47581543767bea554bcbd85f168777b', 75553 ),
	'img/04-add-user.jpg' => array( '2240182ac0968e8c399eb5b87cef4ce68b18282396210a68acb110ed2fa9f45a', 81261 ),
	'img/05-deals.jpg' => array( '2b275a68513c638b7459a6c9d0ceeb5d51a0594395033156c2745233ca98f17b', 141249 ),
	'img/06-new-deal.jpg' => array( '81387047ed95f432894aab9a14fb20991c7ce96d955b5b70fdf8eb29567a80af', 138530 ),
	'img/07-assign-slot.jpg' => array( '3a1d890df31b8a1d3d2d0c84f5d4051e9e7453a1afb22bc244ef6f0a57583a5e', 146727 ),
	'img/07a-blank.jpg' => array( 'ac6e062f35d7bb398794a823cc6290d5f6fb125fb80b00aa37ae57a4901c1ee4', 146661 ),
	'img/07b-assigned-all.jpg' => array( 'd3d16e40f3326d0a8da34a26c1a71a20cf632aad6814bd39866743bbc4b6f5c6', 146757 ),
	'img/07c1.jpg' => array( '5f379d2e4984047ee2b1bd3e7ffa139171dad00bc2de7f91fb2f5bdaa671c992', 148022 ),
	'img/07c2.jpg' => array( 'e78fc489df950c48fb37d6b08686cc2cefc5b88e66e91a9ecaa509cf1148b33a', 147770 ),
	'img/07c3.jpg' => array( 'bc4b88d7bf47d4e95428391d32890f2242533c66def4f8c1e3d362b6a49bca0a', 147262 ),
	'img/07d2.jpg' => array( '9a6f7b5444c6c564edf3ca155cf34482bcea7fe86290f02a8088841e39f28952', 147275 ),
	'img/07d3.jpg' => array( '8b08acb48a3bdd7403c14e49e00bc4ccb5f771eb9ea22f78c681de6be3cde663', 148642 ),
	'img/07d4.jpg' => array( '23d5e876c8150aadb513e64b980570677085589d5e2db8a8c768ec029c6602ea', 149593 ),
	'img/08-deal-finalise.jpg' => array( '44883afd3f0fb5519b03c8b163a5abf11741b0fd0c8082182835936ee7047e32', 142621 ),
	'img/09-deal-live.jpg' => array( '3972e7507360bdf53e94dc605ec8c42d0d2abb9067004f3fe7228146401e1527', 144219 ),
	'img/14-approval-table.jpg' => array( '30bab1d992cf65f2a049431318f44342f7f84518f7d02ef22b14e7069391dcd1', 115936 ),
	'img/15-approve.jpg' => array( '1900d591621735cd575579fdc3a1bc59d36597401baa0e6d794e63bee5028168', 122869 ),
	'img/16-booking-schedule.jpg' => array( '6d19dee7378933d0ea4dcbbcd2f469408e41e95159ff6f48aec2016440d90e3f', 184210 ),
	'img/16b-booking-flight.jpg' => array( '29d39e7f63b2ba97c52e851d4c2354d190957eb12936d1d7e783ac055aefe25f', 159316 ),
	'img/22-booking-revenue.jpg' => array( '953677bd26f9771282ed6abe92dd0e04c9d008a8eda027c9e6680a859c21b216', 164136 ),
	'img/P1-display-types.jpg' => array( 'cb97510c837da637001a83d81a825cc7a87844a607e80f9abd4390e005394086', 104500 ),
	'img/P2-playlists.jpg' => array( '1edecad7ebf1acdf37cd2316e9523dc081cd051b1873855888801eed9f159b62', 90542 ),
	'img/P2b-expanded.jpg' => array( '2f18d6c8676d208081cf69d7b2367b88ee608b3cb759bf812c3a0d3fbe21a624', 117855 ),
	'img/P3-three-slots.jpg' => array( '363cbc1a19b9b242c1fd8ac49966c7c637ed292e5481dc7262979e8b791b5f49', 109122 ),
	'img/P4-owner.jpg' => array( '736a53443a1656490b37d0a7037a33d5588dbeb4a39768ea18a8266eb81559da', 129910 ),
	'img/P4a-slots.jpg' => array( '1a4564f72799fecbc81fa170c362378a60fa74fa69daf992e6d4d22e98277e78', 132068 ),
	'img/P5-forecourt.jpg' => array( 'e5e1362aefaa88f289c9cd6191bfbb93074f5650e9528bba89234c57e8cb7d3e', 131648 ),
	'img/P6-shopfront.jpg' => array( '4629fa37a93eb56376ed55b62eef734a987ee18705e5438ff03b40561a678ee6', 125447 ),
	'img/P7-coolers.jpg' => array( 'a523d5dab9d4c07310a2b3e73a13944e1e52975044a8ce3e3ab5b88a5f124c4d', 119518 ),
	'img/P8-pos.jpg' => array( 'fb27e32e04cd21b4af8e6968aca1d44a89b065662e3cba32c6d6f72b94f2dd48', 113885 ),
	'img/P9-saved.jpg' => array( 'fa81d3c410d4fb615cad73b5b1de96cbfce81eefb8f99c8ccfb673e4a5059337', 102969 ),
	'img/login-bg.jpg' => array( 'c2f822cd33039b3a27c1665c98fd8c87b8a90ff6f408bd5dfd754fe1d0282b0c', 11605 ),
	'vo/f1-01-1-4e6a1cf7d9.mp3' => array( 'df4279f5ff60ebe09e25338ad7bf9bdc7a5e2880d9f59aedd03e6482d3dc9b61', 33789 ),
	'vo/f1-02-1-019cfa9967.mp3' => array( '6bde1052332e38df9c9d5544a89f8c4c882556108223accd07a1d2bc640893b1', 10893 ),
	'vo/f1-02-2-e1a1e04b87.mp3' => array( '56fe348f2efb434f64aff8e69e88150bec08a9c5eb003b1198af855358359553', 29325 ),
	'vo/f1-02-3-88a9ceab86.mp3' => array( 'f1feb6d5ffcb95f9611a7e88f25a1b4331fb194f363e133b2eb55fa0189161e4', 24717 ),
	'vo/f1-02-4-41211815ee.mp3' => array( 'e679e95e4a1f4a76228cb9f3b1991e86e728bcf3365a391d3fb8c16c4da76f65', 18813 ),
	'vo/f1-02-5-9f9d0e125b.mp3' => array( 'fec1b2371fa215116728796a483e995e573a3da7e44d44bba0b8a5518a70ee67', 18669 ),
	'vo/f1-02-6-94ca378e3f.mp3' => array( 'c610a04fac4361627a086cd983ad289b99477021a13ed8576d875c7b637f1f5d', 34509 ),
	'vo/f1-03-1-d4761b039d.mp3' => array( '7b57b3ff338386260fede6fe6213553c057a41d1fd77fe47942da35e63aabde1', 28317 ),
	'vo/f1-03-2-e70fb76ac7.mp3' => array( '0645f7e058f761a77e74f83c3cd6a08a8bb8dde84570a0a00e984174745dd3c0', 20109 ),
	'vo/f1-03-3-b1b956b775.mp3' => array( '93b0921c35d60c4ea54c59385874c3cc8f5fa31a7a173acc4e76ca875d301ad2', 27453 ),
	'vo/f1-04-1-5d3ff27ede.mp3' => array( '12a95e2383f7fcb27642dce551b16cbe615d65f86c251d0e0984aade30b6031b', 42717 ),
	'vo/f1-05-1-815ef1fcf7.mp3' => array( 'bb152578ab24b6e2c4edef9607e637e2a6e0727c1e2fe876c903b90a20746aff', 30189 ),
	'vo/f1-05-2-a895affdb3.mp3' => array( '3e4f80a3f156b1300f2769d1b2a6312bd3219c307a82d58bd374301b7b2f82ad', 36813 ),
	'vo/f1-06-1-bb4dc242cd.mp3' => array( 'a30fdc6d0c7704043a8a3f70b8a5c2865b91d050d81a6ec991330958ed7f23bd', 27309 ),
	'vo/f1-06-2-b979dd0bac.mp3' => array( '10b4495c22660662025169302c9c8915538f5f92e00e0aa288d8123e633cf44c', 24429 ),
	'vo/f1-06-3-920ae8dfd8.mp3' => array( '0817ee46e454fdb86942cb2adab6d472bd81effa4c8eda5cf8b4b45f294ffba0', 24573 ),
	'vo/f1-06-4-70953acd20.mp3' => array( '4a7b2bde2c591b504bdf0025248db28fae824411e7efc2119d91e236f255acf0', 17085 ),
	'vo/f1-06-5-9d85756903.mp3' => array( '237cb953353adf60b542d380264a0c4e64d8140259b39a7597e9058f3e7fddd4', 31053 ),
	'vo/f1-06-6-0a6c6b9bc2.mp3' => array( 'dc9586c36a2051fec01290fd864d8f1f395121fe2007a287adb233028b365e43', 34221 ),
	'vo/f1-07-1-1007aa5f04.mp3' => array( 'af6f5fa33b4eb8b6e606e1d1f46b3bb5b4995eb0541aa57d766ccd03e2a85d0d', 31053 ),
	'vo/f1-07-2-810f46105a.mp3' => array( '8405c86b90828149a147d67828a1aad075e9196066a916ef7fd2277448de2e55', 33933 ),
	'vo/f1-07-3-5dc08dbfb1.mp3' => array( '6905ce3765f88b48c09cc80e5a647fcd1fe352ef25a0e8c798f3f483bed5dd3f', 24717 ),
	'vo/f1-08-1-59e0868c89.mp3' => array( '558a9dc8e2c72f0909f6a7390ec1527a85f9b5cee485ff6886c162f851746c7a', 34653 ),
	'vo/f1-08-2-37fde762a7.mp3' => array( 'd7625dc740d6611c8c058223b4f29f1c9348207a8744d30d3caa14e8b382ccd5', 29613 ),
	'vo/f1-08-3-6623a4af25.mp3' => array( '4cfa675fa06ae0feeb13e1a0dd26cdac65a1bb51380e57d30650f6a0f5fe8053', 26589 ),
	'vo/f2-01-1-15e22e5b99.mp3' => array( 'b7f9b1a1ebe9c7efb3d8abebe6d7875fe771b0ea39a462bf3095e5bace5a2d21', 52365 ),
	'vo/f2-01-2-b34e26f837.mp3' => array( '65bc97d7d67cad1827a108b69f2ae0cc7db392c969d283a24ac89287b73df027', 22557 ),
	'vo/f2-02-1-311f6763bd.mp3' => array( '5c9c6d31861260a922c6c33c3bb5eb160b1dedea71a070e256aa5a546dea7af4', 29181 ),
	'vo/f2-03-1-9af0217766.mp3' => array( '4db03b80847ce53a492751bf8576cc8a5046c16a240b8b0c026acfd1b8a06e33', 31341 ),
	'vo/f2-03-2-045001ee62.mp3' => array( 'c751bdb369af8f83bfb64ad21d281e721cc291930bf8036620b5d57633c6c200', 32925 ),
	'vo/f2-03-3-31c7a5a55a.mp3' => array( '416e464e10b80a2cd91b32a7940a40fb3c94e8f57c4cc9b20b8eb0cb948ba0bf', 20109 ),
	'vo/f2-04-1-f01e28545d.mp3' => array( '66e3336aaefa6a69eeaa9ecf865737297acfd06b6c06c11397538f070c1db233', 29037 ),
	'vo/f2-04-2-635ecc078c.mp3' => array( 'f71e5d76fb18fb6b97aabafc53e123e0a45d6056004bb83f71b1d998d8de0f11', 17805 ),
	'vo/f2-04-3-0335984f58.mp3' => array( '92aeb7b94d2f4e862267a694f17e47487917a19a7f487ed4093a4a42d6961962', 34509 ),
	'vo/f2-04-4-7ded1c15ea.mp3' => array( '72953af72009fe1c971b1c325e793edbc7ea4f8bcf50ee171f49f34d7a8b700c', 25869 ),
	'vo/f2-04-5-15b9d9f7aa.mp3' => array( 'ae06b40a9bb6ac9a8c2e08fe7c4878a30cb38aed80d7421c61754a8fd4cb24a4', 15501 ),
	'vo/f2-05-1-72ad9f5f21.mp3' => array( '24872bee68dd945488cf6c2fd5b7f7165a71a29a08a5692597552524d89d1eca', 50781 ),
	'vo/f2-05-2-67ab4ee24b.mp3' => array( 'cf074f63f3bfaaa4fbdc5c30f5dc5dbf8fbeccb769dcde2ae0bc872e0667f206', 18669 ),
	'vo/f2-06-1-247e067fe8.mp3' => array( 'ab086f8a7756dd25105002abc3e1f43be6f90f03ea4406702216c90e643a0f55', 32349 ),
	'vo/f2-06-2-a80f61db0a.mp3' => array( '311072f50f6f1f9c710ed1597dd576921984f044d8c9af88f7ff6ba2c2b441db', 34077 ),
	'vo/f2-06-3-66c9dde6be.mp3' => array( '085c8405d86659806940907aec8a8c33533c8adafe89db5e3b0466e42188d99b', 38685 ),
	'vo/f2-06-4-a4c96f7f72.mp3' => array( '0b2ab7084d60ed923668cec7bcfaf516b3786c9bd7e038760f448f3c66829f15', 15501 ),
	'vo/f2-07-1-b40b0f835d.mp3' => array( '3ef2a91bdb13785efe789525513c0514fd07409e9834aea7887d347bc7ac233d', 49197 ),
	'vo/f2-07-2-0cb584fce6.mp3' => array( 'd56db1c56592dfedcc05318483bf95bd9fca4de3c3d749cd3605c5e5ed676bda', 35517 ),
	'vo/f2-08-1-c4db39ce74.mp3' => array( '5c7756994f52e07f70128000f25649651b21c0df1d6b576bee0888159da23556', 23565 ),
	'vo/f2-08-2-dff38479d0.mp3' => array( 'ceccdd0917864e6863450056ed3e0b94d1003a94c18488e9f2a4204c0965e635', 29325 ),
	'vo/f2-08-3-1cdbf597cd.mp3' => array( 'bf1d2061c51576e71a8d6e9b1470d9878e16d1760f3a60d5fd5040ab0a6d4803', 22989 ),
	'vo/f2-08-4-290178c496.mp3' => array( '652a355aca4fc35e38e1f8568efc8ecdaae24fd4400657563ecc16072b4b80b6', 28173 ),
	'vo/f2-08-5-860c310ff2.mp3' => array( 'f7616368aa2d0ecff9e357b8eb7b30648801700d0d471d52b86969773d5af97a', 33933 ),
	'vo/f2-08-6-5524f565de.mp3' => array( '243a782a4588947834c58fea5b7187f2c1cc5b8f5a6588d04ffa40e739206804', 22845 ),
	'vo/f2-08-7-f3e248ff41.mp3' => array( '6b2d8a99485cb80d9c9665c386873abd983f7289863b59b1d6dbc68f854dd77f', 29325 ),
	'vo/f2-09-1-971fb8ad70.mp3' => array( 'b82e5a668ae0b05a64e668d1b8ee92fddc5552db7ce20257ae8e2884b414c301', 27165 ),
	'vo/f2-09-2-466469aa88.mp3' => array( '0d7cfa0cb05626508615d105e952fd98bc081e3d989c4d5837cddc213f8333ed', 21837 ),
	'vo/f2-09-3-236dd2d126.mp3' => array( '019a0125d6bd51486d3507a860e074374129179d3fe9bc22b7a61fa39850571b', 45165 ),
	'vo/f2-09-4-a1ce565bd2.mp3' => array( '325d03597c96d9c3dde3b3c07d57cb830a9a5701919208240fbef072802c6e81', 37101 ),
	'vo/f2-09-5-21b66dfcda.mp3' => array( '9a0f297e981a74a3a3bf4c28629dc4c322163dec518ed1f52e82e7bc6938be88', 36381 ),
	'vo/f2-09-6-25ad0a8b40.mp3' => array( '2040a27968930713a99f70fb786d735623da06c67279282ade225fce327a4855', 31629 ),
	'vo/f2-10-1-f1dabdfa14.mp3' => array( 'cb5e28d69bad92348a69f6cbd88fef4a41d5cdb3844b7f44876410e1e8ececcb', 42573 ),
	'vo/f2-10-2-81cd7ddf45.mp3' => array( '5ad2a5cb689dfcba7755b8812425b9542bb4bd046d693c98bfd4f915dceb0c48', 38541 ),
	'vo/f2-10-3-2dbaa4ce3a.mp3' => array( 'ebb4a51f7f1cb1cb12544062803eb54b6653b79448c587fd07388141b3b4cd07', 28461 ),
	'vo/f3-01-1-efdcdb2629.mp3' => array( 'd3037f974d2db1ccd1d0e7feca1845773fa452c7533147d469974bf033b36f61', 23853 ),
	'vo/f3-01-2-ca603efc83.mp3' => array( '291cd55e3b9df3949346f4deddc185a7cf22bfc51aa389964782c9121ab16cf2', 27309 ),
	'vo/f3-01-3-e90e3201e3.mp3' => array( 'faa916e687f0d41fd265e63ab1f0d6bcde0b2afe72a1aef2fb6c20bc9629d06d', 10461 ),
	'vo/f3-01-4-069ece1be1.mp3' => array( '67e8522e52c408ec3a3698967d939573742962bf40f754317361007ded422ed4', 16653 ),
	'vo/f3-02-1-4830a706b9.mp3' => array( 'ab3a5d129f89cfa4e7cc377c80c8b47c3dd78e581bf0927162738636dd1576fe', 30765 ),
	'vo/f3-02-2-ad4c89c794.mp3' => array( 'aa1763d8c4e6e22051e687cb81e0948d0ef86031cf8961f628eed6e67d6ddcb2', 19677 ),
	'vo/f3-03-1-97fe869e29.mp3' => array( '145cde375301bbe45a4cf5609014731f775914aef2a45dfec333dd6723767ad9', 31629 ),
	'vo/f3-03-2-c148af44ba.mp3' => array( 'fb0d04eb5a30c46ec4011d34c0c1347cb078fc367dbbef4c66c8c41bf7a900bd', 19389 ),
	'vo/f3-03-3-ece7bb359f.mp3' => array( 'bad8dd4d234d14fd0d2191c650eb4ab6c13b5551145157d14ba3adb0237e0893', 6285 ),
	'vo/f3-03-4-70568d93b3.mp3' => array( 'a19d7e7b09d84299fd149fa99e395ce61df95d9c41cda0447171487e0ec7da2a', 28893 ),
	'vo/f3-03-5-1592073a36.mp3' => array( 'a7c651c681fbb5fabbbb0f45b15dceb5576e3920f1895d4fe78c858c6d9bda0f', 28605 ),
	'vo/f3-03-6-21b34710c5.mp3' => array( 'c3d0e82ab7ac9ee09489cf070202cf8b41448fcbb9a2bb6f2e6c7f85e3d74ebb', 28173 ),
	'vo/f3-03-7-3874b1ce8d.mp3' => array( 'c92e372f8ac5998a11b71e5db2ad9811b51ae12deac392d9be3171a62837bfe4', 32205 ),
	'vo/f3-04-1-80ffd5f1b7.mp3' => array( 'b53b7757b5a8938a371975e820a9158a49895c7a08a08a17ea883879f389c225', 35085 ),
	'vo/f3-04-2-7d6c8730ed.mp3' => array( '882850b4d5c4e8aa73d7d83a8fb775bab3950cfab89b4ebcf2f523efe30dbbb1', 32637 ),
	'vo/f3-05-1-b9f1e531a3.mp3' => array( '72a8b75c41f2780f62e28ee270d9f56ad2748c820066339e9202a0b1ae66001d', 34221 ),
	'vo/f3-05-2-59b67e01b8.mp3' => array( '9870fb50bd1e811439af6cae3437d80056e4015af6d6d597b15817f2e138f9f2', 27021 ),
	'vo/manifest.json' => array( 'c631ca72c50018168df97b2b13bce418a01fdab83b2497cd57b1af7b5f939410', 16609 ),
);

/**
 * Run Your Own RMN walkthrough assets (golf). Allow-list: name (dir/file) => array( sha256, bytes ) of the DECODED file, generated from tour-assets/rmn-golf/SHA256SUMS
 * by tools/rmn-golf-tour/allowlist.py. The repo holds each file as base64 text (<dir>/<file>.b64, so the train can carry it); it is fetched once from main
 * (then the jsDelivr mirror of main), decoded, checked against this list and cached in uploads/ph-tour/rmn-golf/v1/. A changed asset needs a v2 route and map.
 */
const TOUR_ASSET_PREFIX_RMN     = '/run-your-own-rmn/tour/assets/v1/';
const TOUR_ASSET_REPO_URL_RMN   = 'https://raw.githubusercontent.com/offline2online/rob_ph_demos/main/ph-website/tour-assets/rmn-golf/';
const TOUR_ASSET_MIRROR_URL_RMN = 'https://cdn.jsdelivr.net/gh/offline2online/rob_ph_demos@main/ph-website/tour-assets/rmn-golf/';
// rmn-golf allow-list: start (generated by tools/rmn-golf-tour/allowlist.py)
const TOUR_ASSETS_RMN = array(
	'img/01-advertiser.jpg' => array( '71602d9090c3f8f6ea38c577f08bfd78f9817b8a1af9ccc7d785ef40034638bb', 150462 ),
	'img/03-users.jpg' => array( 'b96bb675e859ff27958725f9aea321004ea2c866dfb4e5f73e658ae2b9a615c8', 76313 ),
	'img/04-add-user.jpg' => array( 'ef057cbea665f9cccfdc67542b87410954b81350c860469ec35305104b2fcf7e', 78001 ),
	'img/05-deals.jpg' => array( 'd848c1e7e4c7b76eee53539c19eceff1926d7ee61fb86f802f0715711c5417d6', 148380 ),
	'img/06-new-deal.jpg' => array( '19395c3cb37eef78377b1d7cb02ee5f0da4a33438532357e0b6813fb080c5ca1', 143040 ),
	'img/07-assign-slot.jpg' => array( 'a6e64c3caa4f8cf609b4bcb6eadd23a77d6dce3913b75bc4408f1224701202e7', 152438 ),
	'img/07a-blank.jpg' => array( 'f150eafa6b21d67bbc32666c879b976544004166e48232c60b90256e6fa2c54e', 155315 ),
	'img/07b-assigned-all.jpg' => array( '78f8bebe3f8cfeb1c95c5223d6501f28941440bc37991922f1b25c1b298a1d76', 153516 ),
	'img/07c1.jpg' => array( '22cae75214dab892bef11a4b16b70cedf521ed5b28822bcce32ab3fa3569d3e6', 157158 ),
	'img/07c2.jpg' => array( '33e8ffe33fa46e96fbb5929199b79e61a99bca2530077a89b42b5a0eac849577', 156321 ),
	'img/07c3.jpg' => array( '0eb8014a76c2bb26be64f7c82291bb9b20d6491b4900a3b13334692bd1df2372', 155772 ),
	'img/07c4.jpg' => array( '8bfbc17ee9e41667fb9479be7d8d2bc0fcf02ac506ad71189adcdbef6fcaae1e', 154893 ),
	'img/07c5.jpg' => array( '511d831364abf751d8382d15dfd6a07f03d38aaf1486b030d4a30fde7d009699', 154454 ),
	'img/07d2.jpg' => array( '31b7660bdf2306633a710dc8647b63180c4c34ed76cee5731ac0e788e6345bf4', 154739 ),
	'img/07d3.jpg' => array( '65bbb7890de1b852d6e561d725c565552df7e4069f65fecb718bb858004b5a53', 156414 ),
	'img/07d4.jpg' => array( '23d6f64446a3c755e4e4f04550f6b2596ea0d7d8556df807a1a829a684edd852', 155734 ),
	'img/07d5.jpg' => array( '33f49fe01835c6512f814708ecd22df530d1253cfaf1bcc8f865b3df74b20d4f', 157455 ),
	'img/07d6.jpg' => array( '40fa5d97b8c4e5c9256525e52df97b2962745ef59690da701bbc59b01ae2046e', 153307 ),
	'img/08-deal-finalise.jpg' => array( '0c3b1ed2680c5d9a4571d3da1c42a7f4324efc70b95f414eba6626c93db61b78', 143867 ),
	'img/09-deal-live.jpg' => array( 'f9358766bad29861d45afa1b3c08f13a9d9fc76a25f4b4d550a6558446e5a811', 145640 ),
	'img/14-approval-table.jpg' => array( '82a8be1482175a59db857d71504262e6d84c462969ac996930be7ad9da01ef49', 113594 ),
	'img/15-approve.jpg' => array( '3cbeb0d88529264ecd03464e663b3c3db061d2aab2f4133976e0c9c6afd1898e', 120977 ),
	'img/16-booking-schedule.jpg' => array( '9e67873c22adb356242e85132eb5eab5c5b74982dde2ec4ea6715ee902b1b2e8', 202044 ),
	'img/16b-booking-flight.jpg' => array( 'f410ec21abdedf3b80585c271dbec9570edaff287195f897c458300c8e76b5aa', 174866 ),
	'img/22-booking-revenue.jpg' => array( 'cd61fa6df62e5bc0375e119dcbce3173f4a885174b11bd9e3a0d924a584c7221', 176168 ),
	'img/P1-display-types.jpg' => array( 'd769de7ee826acc54ca8e79af4a5c043160616298e83a6c1a086a876e0da491e', 102038 ),
	'img/P10-bar.jpg' => array( 'c32f408b571da5351f375852c139fe1bb710b2b6a2cc2b10193a67a79ebfe9d0', 108896 ),
	'img/P11-saved.jpg' => array( '22232c96b77adfb37ceab1d62fab5c4797a9b4224edc7327599252f40e57051b', 120715 ),
	'img/P2-playlists.jpg' => array( '110ee441580e3d6c57254915bb8a5ebe3b2de1b821398ae44fc2220345e61fb6', 98720 ),
	'img/P2b-expanded.jpg' => array( 'c67a0f07f17f5738f264995f56acb0a57e7862c47707b5db279996d09d8755b4', 126949 ),
	'img/P3-three-slots.jpg' => array( '2c26915354c700069ecd16ceb1ca92d8ae9656e783bbcc5dd61ec0bc3b7a2927', 108276 ),
	'img/P4-owner.jpg' => array( 'f633a727562a3d8c8496560a1d72a39913c8e24a958d7d39528f289da5e0e09c', 139674 ),
	'img/P4a-slots.jpg' => array( 'de32920a3129ccbad8555438c454d881e49aad9f9d34adaeac2e52b2ff8b1082', 140851 ),
	'img/P5-proshop.jpg' => array( '2f99fd3c4e052d2a08ccd2bdd43b3d6e5744a174b3ac808a982c89d0fe2fb5c5', 141096 ),
	'img/P6-range.jpg' => array( '7ebabafd5e7b34e59e2910c9bb10ac869c7834c4d501c9d29af38e03df4c0009', 135100 ),
	'img/P7-tee.jpg' => array( 'cb1829adaa78756e73ecf0b66b5a04b982258379aa1db8b637cbf5f0b4eb8403', 129128 ),
	'img/P8-halfway.jpg' => array( '66ce854d65d8d2d48f1c8d31dadca5e503e4847dec6650484589e33de8a8fa6c', 122310 ),
	'img/P9-locker.jpg' => array( '6fe969cb31b3064171f77a2e232acfc085b65f2955f278e6d765cbe1f084c5cf', 115424 ),
	'img/login-bg.jpg' => array( 'c2f822cd33039b3a27c1665c98fd8c87b8a90ff6f408bd5dfd754fe1d0282b0c', 11605 ),
	'vo/f1-01-1-0ca14d91e8.mp3' => array( 'ddf11dfe90a83d0c6645c27c6ff057cbf63067ef9825e6f9316d824227b5071c', 53229 ),
	'vo/f1-02-1-019cfa9967.mp3' => array( 'c6cc8614579805501509fff32a614467ba101e6c1e34cfe375dba131b98b6834', 10893 ),
	'vo/f1-02-2-6a04d41418.mp3' => array( 'cbd4a1ebc6708035bcb6c9725075a8bae31c8d78488c0663b7a667d70d581d07', 30477 ),
	'vo/f1-02-3-7b0d89f97e.mp3' => array( 'b35672a2f88dc95ddd3753e4c92917785c1a3e68146466c39a8f04b45811bff5', 22557 ),
	'vo/f1-02-4-3074c07335.mp3' => array( '8ab7365167a5709100febef4d2f43169581d7a5f64e97413d40a80fccaa712b7', 16797 ),
	'vo/f1-02-5-9f9d0e125b.mp3' => array( 'e79e38fee13f9596603f5490d391afa54740ba19afd12309121960d80c39a83e', 18669 ),
	'vo/f1-02-6-347b7770f4.mp3' => array( 'bf06dc769fa7dbf82e8bc66cc575b973e88cd8dc6e11ca45ec416fc617c13a02', 32637 ),
	'vo/f1-03-1-1e0d92d0f9.mp3' => array( '1da7e582d51e9807329e18acc1e4d0a51edbcc1d4af32b11db650ff0e3435806', 41133 ),
	'vo/f1-03-2-51556feb16.mp3' => array( '198042d9fdf9e0dc372bac8d9b44573808e19a92057f93af716ea8e97b9b54e2', 19965 ),
	'vo/f1-03-3-ab521c1d61.mp3' => array( '63d0de5701b6bc440635c80aa68114a0fe73ad358988c33eb624c27b7106d86f', 27165 ),
	'vo/f1-04-1-a88a9779d9.mp3' => array( '6baf0f913eb35e74ccbe9a8c56ca11cd98800469c0f085a814ffccf1277a1f8f', 40125 ),
	'vo/f1-05-1-815ef1fcf7.mp3' => array( 'd5f8b20c7edbaa1de03d3a6719d913104b4fa6679b6382e045aa898b8340c3b3', 30189 ),
	'vo/f1-05-2-2ff4f4c6b3.mp3' => array( 'f7f5903f31426e41be7f19f2168b6b760965523483fc5707737da055a53d8d09', 36813 ),
	'vo/f1-06-1-65160b6df7.mp3' => array( '3c8775380dafb48d255f1a5e59be01e17a49ee0791f456cc4de41e483fc512ae', 27453 ),
	'vo/f1-06-2-a2b377b099.mp3' => array( '46fece91c25d29f7e2d6de5ade329659ae72bac91b80ed66b1656b2d41ecca77', 23709 ),
	'vo/f1-06-3-920ae8dfd8.mp3' => array( '5116ad4fbd2d8a2ec71048f7a5923c215db0a6ec724fa75d2bf77519aa1f964a', 24573 ),
	'vo/f1-06-4-daa95efabb.mp3' => array( 'f054177a331ce335d26be25fd493487bdb8182fb0545387e82637443fb753b17', 14637 ),
	'vo/f1-06-5-9d85756903.mp3' => array( '46881e2ee1e2f0c13a738b2c946fea1e09c08e2aefcc2952df91644b9082a02b', 31053 ),
	'vo/f1-06-6-727fafb5dd.mp3' => array( '47b04c9306f0c8c2f03d807d0bf3b1f04326b816b3dbf9c4bb0bedc00807df8a', 34077 ),
	'vo/f1-07-1-1007aa5f04.mp3' => array( '33f5b75a2ddf4a15e1400903753049052fef509d2b0d7b79bec014bc57c52a0a', 31053 ),
	'vo/f1-07-2-810f46105a.mp3' => array( '15fbc324bb0be472c012f1fbdfff1b85fe75c36a3951e4a54fb272f85e309f9f', 33933 ),
	'vo/f1-07-3-1b34406dde.mp3' => array( '6c2587a04c11cf28f48c66ba36a4dc89614828fe71c2a51caf6e63b04f658a5e', 23853 ),
	'vo/f1-08-1-cfc10cbd0a.mp3' => array( '20cd80cd755caff80aea24c43f271603e37a564a2ec61ef80a68d21554790b83', 32925 ),
	'vo/f1-08-2-f1dd3ed422.mp3' => array( 'fa8eaa0c7edb3cda2b2cced96a1c5e4e4256c12f6df1b99f690611070d441864', 30045 ),
	'vo/f1-08-3-9bc2f258d9.mp3' => array( '031eb2d0f32856f54a6283d972838c5f465cbc69c4211b97fb6a3b2c43dcca57', 24573 ),
	'vo/f2-01-1-c32289aecd.mp3' => array( '4d6a921c9b8e8aca97d4c759ec7f86728ea27c7a95ad8064893be90b9eae9fdd', 47613 ),
	'vo/f2-01-2-c5591910fd.mp3' => array( '6786902396919eef2d749652b15957c42becc64dc4165e7a52f80ae5325dec47', 21981 ),
	'vo/f2-02-1-657e007c88.mp3' => array( 'ebc3edd587ba31fac9b8280f413da1b925bbdd940c34f04da797f261ea0f1f8a', 29757 ),
	'vo/f2-03-1-26a12d399b.mp3' => array( '2bb5d47aecffaf7935dea78381299f8a063a5fc872f6b8c6e288c0bf40da8e9c', 31629 ),
	'vo/f2-03-2-d18f886bef.mp3' => array( 'edcf08f1f7d1ea467d84e6ae088d3f5ca107b01099c7cb831f08bdf97de38316', 33357 ),
	'vo/f2-03-3-31c7a5a55a.mp3' => array( '481d62f3b21e90cb0eb334d0488bc57f60a9226664a05b3b84c3b6733b93ee75', 20109 ),
	'vo/f2-04-1-6c5f3cf27b.mp3' => array( 'd29cac81cab1252d6ad7cf6e1ac140941433a1d046a29ea975452351bb4dfeac', 29325 ),
	'vo/f2-04-2-635ecc078c.mp3' => array( '21ca3425e532c9660c3d82facd0ec702e0f8b003454d709af4d9a05d3abe1d27', 17805 ),
	'vo/f2-04-3-23d07dc5f3.mp3' => array( 'b139a035af7cf5e76e962ea380aebcf2d64e5e7f5003bb45241c7a2219aa3dc5', 33645 ),
	'vo/f2-04-4-7ded1c15ea.mp3' => array( 'dfb02faac4fa01ae02464dbe56da13a846b9052b2af3565877bdc9baacb40e6c', 25869 ),
	'vo/f2-04-5-3082a3daf1.mp3' => array( 'cb4168c0063e9baea3688b1caa66dc6d3a47d23a594ad1ee51f51daf63a874f4', 17085 ),
	'vo/f2-05-1-1cea3b8bb4.mp3' => array( '256aebc24254ccf955c4a52b8eca200fe6fbd44865592ebe3a5f7f2b3bf709da', 48333 ),
	'vo/f2-05-2-67ab4ee24b.mp3' => array( '8a9caf11dbed2829b2a31d1f1e9b2416a8d2804b373a8d0d69e2d62bfad416f5', 18669 ),
	'vo/f2-06-1-247e067fe8.mp3' => array( '451ddcb73d71564418ab147642903464470dca075581f1633f7b301e86b5f435', 32349 ),
	'vo/f2-06-2-a80f61db0a.mp3' => array( 'b64af2b22b18fda5a2474097ff7c97509c9bea22d3f921ab9783d9d5c18ce0d5', 34077 ),
	'vo/f2-06-3-c935bc221a.mp3' => array( '8feb18ed51a9ed601c38c8236500442b3d729d648299c278f76c2fd788070600', 37965 ),
	'vo/f2-06-4-a4c96f7f72.mp3' => array( 'f5cc1ae9ac92f5cfa4a7a698f250094ae5681ccbf7c1257de41e700e4318fd34', 15501 ),
	'vo/f2-07-1-8f51435a80.mp3' => array( '45f4f73291815a32ca1c2a69efbba0b9c6f61aef4a3ebd3716a34a665b350fca', 42141 ),
	'vo/f2-07-2-ff4de61fc3.mp3' => array( '13dec50ccdc9fa8e542ef719104a4bb29ab46bc4fc07a93e580c4918b2008e23', 35085 ),
	'vo/f2-08-1-f21a7b6059.mp3' => array( 'b31aeea181d2de8eda2b86cc7421b15e34cb41b1ef164936ee0175dc2017988b', 25869 ),
	'vo/f2-08-2-27180fa2ec.mp3' => array( '01134657587d67fd395914d9de290cde2404608a3dcce2921e6e385dd54d8a61', 27309 ),
	'vo/f2-08-3-69ba1260a8.mp3' => array( 'a659773162fb86f7253200736aa720a2830b11b2f5b09331839fc7fc88ce43cf', 25869 ),
	'vo/f2-08-4-290178c496.mp3' => array( '3ac14115597695297a8c9d53eabd1573a16677f583930039acd91f14c4fceb92', 28173 ),
	'vo/f2-08-5-97015211cb.mp3' => array( 'a15cec8f23d4b08bf76f0a8ddcf27a1edf1864e31030a8e40c023f2b1c40f1ee', 31629 ),
	'vo/f2-08-6-064787121c.mp3' => array( 'f2673e04bb47fd404419b49aa0a8ce3206ffce99e83b11d0163b6fe559682251', 20829 ),
	'vo/f2-08-7-125138750f.mp3' => array( '31284e37aec692eb7f67b42f0fa27b7aee48ad400d0d14d570096388faa4e9df', 26733 ),
	'vo/f2-09-1-eec78fda24.mp3' => array( 'ac2b15d9da6b3346efad3fbf67beee4b7f73f78bb778564dacf6d98ea82ea3e3', 27453 ),
	'vo/f2-09-2-911c941a99.mp3' => array( '6b3f1928aed86e3aa83dc03803fb9b3f18556928070cbd9e27248ac2d00afcc3', 21981 ),
	'vo/f2-09-3-0b5161a037.mp3' => array( 'ea91b023d2c866ab7914f84c7a6baf43ba158cbe5d155779d9d2976ec21b7a3c', 41421 ),
	'vo/f2-09-4-c1c7d2f99f.mp3' => array( 'c8546d78c818fdd0e17cc797c69d7159512187870c9e00c0f8c658389da46266', 41997 ),
	'vo/f2-09-5-b0bcf5eafb.mp3' => array( '6c802b1dcafe1a780ba4915c04bc182f5528a86edf1e97c7fe10061d61caa14d', 35085 ),
	'vo/f2-09-6-6b79b73760.mp3' => array( '7a897ee6f41e16dc9cd480ef46ef0072a65167ade5765da8d93bd6c6d02a6052', 29757 ),
	'vo/f2-10-1-2d827b6951.mp3' => array( 'c1f8e5916b8051a3eb1d01964bc4976f0af66497f5a5b4d609db15a02d4af6c8', 38973 ),
	'vo/f2-10-2-9c3ee06e5f.mp3' => array( '19b8fa860ce4825e6370ee83645b46cd6fd22ad600191641b26f25727f2d89c1', 38541 ),
	'vo/f2-10-3-2dbaa4ce3a.mp3' => array( 'b533e3f8a24cd3e8d8573129acdcedda9b10846f7790ea4611a905123d430475', 28461 ),
	'vo/f3-01-1-be9fd8aa3e.mp3' => array( 'bba98c5fd16de0f2a51f33ebece6a2ccc92e65267fcffe49bdbbf31099866f8d', 27597 ),
	'vo/f3-01-2-89f707e0f9.mp3' => array( 'f0984274c54abf66038cd47438b7a134edeef2056a0cb0604e794d43ba90d310', 21117 ),
	'vo/f3-01-3-d4c36ad55f.mp3' => array( '28787d39d0569258f56cabc3c0a69d775fe687ed403064b7f737bbeb623573b2', 14637 ),
	'vo/f3-01-4-29c7f09a80.mp3' => array( '230a1b373b8a905ac16c47a2df93eec321e80f0b3be81c3b44fc09b88be63d5e', 15501 ),
	'vo/f3-02-1-6e79fb386e.mp3' => array( '58789a0e0ee12e242b2b0883139aa149e66a14bd5672cbd4a204786ae9c6cce1', 33069 ),
	'vo/f3-02-2-a74e98a958.mp3' => array( '8abd2ab7811bea1754c8fa4843c4cd660b7d5fd78f29305db068cf6a33ebbf60', 18957 ),
	'vo/f3-03-1-1a62b7cd0e.mp3' => array( '9234384056287fae2b9a18a17c4cd6c1e363f13fa59297b6785115da14cda4b2', 29469 ),
	'vo/f3-03-10-211cac9584.mp3' => array( '0e630f766b9c9d76365d01d166377d8cfcdb41871a96ed35a17bcd94dad58d11', 42285 ),
	'vo/f3-03-2-c8e634bfda.mp3' => array( '5ec811bf637ea021e4dadab32d5ed8323b7a1541a1da0440cfbc2065e1f93a6e', 21117 ),
	'vo/f3-03-3-26cc7e0c86.mp3' => array( 'd869985eda5fb31a97f996b512e76ca43cbdebab159f3d409d2ca76e6ce3efa6', 6285 ),
	'vo/f3-03-4-88fe559cf1.mp3' => array( '0e92ca5e0c705c77a1dfe53d87dab9dd1325c6645249928aba6abde9852493e3', 29181 ),
	'vo/f3-03-5-3ccd70bab6.mp3' => array( '608c7b973e46aaef9500036f8fbed54db7e8571dc20eb4d6d9fbbe9929cdeaa7', 21981 ),
	'vo/f3-03-6-afe88797ff.mp3' => array( '5e17f38d75865757c7c14ab6305a4e4dd757f7683bba72b007179f9b6e3c2292', 23421 ),
	'vo/f3-03-7-a006a59c81.mp3' => array( '9c8d06ddef520cb6f8e3edd80d803caaaed93968827359d477e368364a968e64', 23853 ),
	'vo/f3-03-8-1ba22cb949.mp3' => array( '05692d1e0c7d6e3a1272c82b6a21f62f4b28c9cd70bb403027611cf7a62cff0a', 19821 ),
	'vo/f3-03-9-28f1d27795.mp3' => array( 'e6ff5146fb1bf1f7e162126c01548f8738322551a4e598a3d8c3c870e0e7653d', 19677 ),
	'vo/f3-04-1-ceb6f6569d.mp3' => array( 'bf64be90c42a470334753d7b8770fb1f30ef06fa9acb26e5a2693f26c896fb19', 33933 ),
	'vo/f3-04-2-172960959d.mp3' => array( 'c72a5c2db6a93b2b3fec48f376ce20e2c9c17e8137efb917c8beaca5c86650af', 33213 ),
	'vo/f3-05-1-27bc91091d.mp3' => array( 'bddbee5700739e8465930ae6792345fd90ebd0f4068bb564e4813a58b0a731fb', 33357 ),
	'vo/f3-05-2-74cb94aa5e.mp3' => array( '92e91cc604c1148f0f501a1849af1dde3eb9a54c48a873e32a42bd55bd9abe81', 26301 ),
);
// rmn-golf allow-list: end
/**
 * Run Your Own RMN walkthrough assets v2 (15 Nov 2026): the Fairlinks Golf Network (100 golf clubs) sells to Corvane Golf; flow 3 follows a member at
 * Fernhollow Golf Club, one club on the network. Same scheme as v1, from tour-assets/rmn-golf/v2/ (SHA256SUMS there), served at
 * /run-your-own-rmn/tour/assets/v2/ and cached in uploads/ph-tour/rmn-golf/v2/. tour.html loads v2; v1 stays immutable and can be retired once v2 is live.
 */
const TOUR_ASSET_PREFIX_RMN_V2     = '/run-your-own-rmn/tour/assets/v2/';
const TOUR_ASSET_REPO_URL_RMN_V2   = 'https://raw.githubusercontent.com/offline2online/rob_ph_demos/main/ph-website/tour-assets/rmn-golf/v2/';
const TOUR_ASSET_MIRROR_URL_RMN_V2 = 'https://cdn.jsdelivr.net/gh/offline2online/rob_ph_demos@main/ph-website/tour-assets/rmn-golf/v2/';
// rmn-golf v2 allow-list: start (generated by tools/rmn-golf-tour/allowlist.py)
const TOUR_ASSETS_RMN_V2 = array(
	'img/01-advertiser.jpg' => array( '3a41e37dcbe58a87a4fc6ad51d824423bed2847f23f5e0bd373fafa7c25d9853', 150232 ),
	'img/03-users.jpg' => array( 'fc0149eb690c1d196c1b28552dec5661de88532d8c0f85f4ee0b34a348368e9d', 75257 ),
	'img/04-add-user.jpg' => array( 'e331588b4786ff46c9eecee04fcb8761fd536a667291c25e700584741cc6f54f', 77687 ),
	'img/05-deals.jpg' => array( '7a1a6b591e4b720829fd7ca76a43c97ae90e79465f7dcc0c13c013240cc3daab', 148147 ),
	'img/06-new-deal.jpg' => array( '2343dfe214c6c3facf65971ce8474a27d5f3620bef1c7c326d75f65d7071bf54', 143791 ),
	'img/07-assign-slot.jpg' => array( '6e7944319bbd52d83453113ef7bb5835bf3bb0cd5d852bc8bc111e0ab94d2a38', 152032 ),
	'img/07a-blank.jpg' => array( '264de6665872b5a007f6395ade2587b6424a6aa023469a4fc6072994b14b2fc5', 154966 ),
	'img/07b-assigned-all.jpg' => array( '939ad0de936dbfae243206520a7500d3b87030aedb46c302f92f5d98950f74ab', 153173 ),
	'img/07c1.jpg' => array( '0aef5e81c85c937d6f558cf3367fa3cbef10183927c237bd2b317ba98f77623a', 156739 ),
	'img/07c2.jpg' => array( 'f24ba87e5bf81fd5616e23e8a730cf7838274be58b5736b890571bcc254d428a', 155924 ),
	'img/07c3.jpg' => array( '881c4b54ccce2a50a2e40e0c64b0c38cefeb463e02e0562fc4edf9be57f53688', 155423 ),
	'img/07c4.jpg' => array( 'add20212d310f4adc3ace79b7d659bea70ed23fce3fa51740c6cc8d2d4fbb7a1', 154497 ),
	'img/07c5.jpg' => array( '494a6ec73fdac9bc935093872d33947c9127ac06b339ca6f838e3346131f22c9', 153899 ),
	'img/07d2.jpg' => array( '594712aacd7756f1e6edc6705b912ede0eb212d7ee0059448cd3afeb46161660', 154318 ),
	'img/07d3.jpg' => array( '663ce31f7f7ea50467086bc35fee39444738de1e5291ac5f5c0ea6bc43b58f71', 156055 ),
	'img/07d4.jpg' => array( '8f3152bdb1f9b89a5ef49e00cb50c7738309b7f0e6260ef30ef1089953e3301e', 155375 ),
	'img/07d5.jpg' => array( 'ac263e322b58a151c65296c92d37a5d4f337cce2cf5832410d37393df05d558a', 157138 ),
	'img/07d6.jpg' => array( '447232e47d28ad66a02ff359c4d0fe17aeb94bbfcd81c40bace49bc7a3234e5e', 152925 ),
	'img/08-deal-finalise.jpg' => array( '958323a74e542fd9660d635ec6a431e5c6a0b325aa08cbddc6f1e27d57594ea9', 144850 ),
	'img/09-deal-live.jpg' => array( '4da1e0bf45953140487a502a2dbc1938caa7bf59d8587bfe871a5217976aa26d', 145319 ),
	'img/14-approval-table.jpg' => array( '220013d8d913dbf7e290f118c567f074b89c930c20863109ce81364db842bfb7', 113555 ),
	'img/15-approve.jpg' => array( '974527bf61e2f05d1a5536c4b089e86e5acf560d55d28e3cedb2e2778088524d', 120972 ),
	'img/16-booking-schedule.jpg' => array( 'df67acacff7d0ad8a85c829b33d9e5aeef03cb3bac8a16e7ac17d3571d8af733', 207269 ),
	'img/16b-booking-flight.jpg' => array( '0d9f194a10134ec1dbfd70b14d9a212a63639474a6297bc0c85f70e4c3eeddd5', 177821 ),
	'img/22-booking-revenue.jpg' => array( '6fbca5c4fad737b5b291676ffa1b3c43dfb9a5fb10fc25a4a7ca6b4b3abc01df', 182911 ),
	'img/N0-stores.jpg' => array( '97f548e370a753746bfed1d891de6856ae2a8e7e6f269bf7fe58f2b737c3c395', 160788 ),
	'img/P1-display-types.jpg' => array( '1db9d6ddb91d2cb25f0eaa69076a488db74f195c715b54b69ce37a2a0ec9ae25', 102086 ),
	'img/P10-bar.jpg' => array( '18ef09aa74d27a9ab68aeb4f199b6f73d5127f4dd4208d975b0bb1cf8154fc58', 108879 ),
	'img/P11-saved.jpg' => array( '5e2c58f9b3e137e0fef3355d5ea348d423e3b82372c7a893a3dbe6b78a2f357b', 120665 ),
	'img/P2-playlists.jpg' => array( '8fb482ddfab8901314411006ba0b3a6c7976bdcdc8ad658707e80b394799552c', 98612 ),
	'img/P2b-expanded.jpg' => array( 'dad1e89bea28e4566affbb0101562e63a2fc8c704bf836fc7f029505f26e84de', 127048 ),
	'img/P3-three-slots.jpg' => array( '995431a1251fa663f40fde14b3383548e8c7bf5444b7007df0a0a90578aa5f66', 108261 ),
	'img/P4-owner.jpg' => array( '43aadf747d5891e1fafa540de992778f5549389f82f06572317d0c419091028e', 139598 ),
	'img/P4a-slots.jpg' => array( '85976953f83983d19e55e6b34203bcef44b887cf8c4cc0c5d9b002e7ffd7a0ec', 140874 ),
	'img/P5-proshop.jpg' => array( 'bbf12c3d27c2401952b794c6b258e656fdfa82b21ad8c992ee02551cd993950a', 141079 ),
	'img/P6-range.jpg' => array( '5330a48d70109e3cef349204be4b10210bd87db92c0bf12fcec98e11948743ef', 135080 ),
	'img/P7-tee.jpg' => array( '1a2ba20d1abfa61240843d4cc39d4fbc811dcf08d9b9b0dc7b75fe5ca4a22fbe', 129067 ),
	'img/P8-halfway.jpg' => array( '90d7bdb64a795b6fb0d6b527c2913ba8ce935f686bfbbff1ed4685b30659d037', 122287 ),
	'img/P9-locker.jpg' => array( 'ae1cebe4913fe3b7af6d21833becf99038a8d1d7b23013ddeed119ae75d9e577', 115408 ),
	'img/login-bg.jpg' => array( 'c2f822cd33039b3a27c1665c98fd8c87b8a90ff6f408bd5dfd754fe1d0282b0c', 11605 ),
	'vo/f1-01-1-e84cc60ed7.mp3' => array( '0c91e75d5c2ca8170f77e3b91965bc99fd9ab2709b0042630af14ca200ce3e53', 44301 ),
	'vo/f1-01-2-59dce8459f.mp3' => array( '0b40d73325543a7cba726463bde99f717878d6ee74b68779cfe2d4feb410dd26', 15213 ),
	'vo/f1-01-3-9eb568ebf6.mp3' => array( '7a3517f5eb52c031e7fb41f8abc234082808c744a5e9297c529feb452cf00c80', 19677 ),
	'vo/f1-02-1-019cfa9967.mp3' => array( 'c6cc8614579805501509fff32a614467ba101e6c1e34cfe375dba131b98b6834', 10893 ),
	'vo/f1-02-1-a690bb7e0c.mp3' => array( '113735371e0540c2f70959a8364417b73924288ad22684e3c3cfdd6c74c6836d', 48189 ),
	'vo/f1-02-2-6a04d41418.mp3' => array( 'cbd4a1ebc6708035bcb6c9725075a8bae31c8d78488c0663b7a667d70d581d07', 30477 ),
	'vo/f1-02-2-fab857ce43.mp3' => array( 'd129cb038af418d5a8712c78a9aeb03bd5ded14110e04cb3009bb2869ce52c18', 18957 ),
	'vo/f1-02-5-9f9d0e125b.mp3' => array( 'e79e38fee13f9596603f5490d391afa54740ba19afd12309121960d80c39a83e', 18669 ),
	'vo/f1-03-1-1e0d92d0f9.mp3' => array( '1da7e582d51e9807329e18acc1e4d0a51edbcc1d4af32b11db650ff0e3435806', 41133 ),
	'vo/f1-03-3-55882e5b2f.mp3' => array( '4fa6d8a683e831b7c566fe6a3ed6280921d4b22de4795b101b9b4550c1d37428', 23565 ),
	'vo/f1-03-4-da72026f43.mp3' => array( 'c8c34e672106078ecd65e90e40ab862f037400d3164999099cf00774d4289cb8', 18381 ),
	'vo/f1-03-6-cb8d8c67db.mp3' => array( '82ce5c05099e8aa9412d22108f9ca569ba1ffef9daf95b6a0b307cfccdd73f97', 33789 ),
	'vo/f1-04-1-a88a9779d9.mp3' => array( '6baf0f913eb35e74ccbe9a8c56ca11cd98800469c0f085a814ffccf1277a1f8f', 40125 ),
	'vo/f1-04-2-f9f36c2353.mp3' => array( '08eddf8319ef4ee6b38c86e864faf5d9c9c7dff2a5b0bbf223767f82bdf78707', 20685 ),
	'vo/f1-04-3-3a10ae0a9e.mp3' => array( 'fc67fe13a702f66e251ca33403ea4f78dcff2a82392f2992ca993ce8e462bb84', 40125 ),
	'vo/f1-05-1-815ef1fcf7.mp3' => array( 'd5f8b20c7edbaa1de03d3a6719d913104b4fa6679b6382e045aa898b8340c3b3', 30189 ),
	'vo/f1-06-1-65160b6df7.mp3' => array( '3c8775380dafb48d255f1a5e59be01e17a49ee0791f456cc4de41e483fc512ae', 27453 ),
	'vo/f1-06-2-a2b377b099.mp3' => array( '46fece91c25d29f7e2d6de5ade329659ae72bac91b80ed66b1656b2d41ecca77', 23709 ),
	'vo/f1-06-2-bf19e63694.mp3' => array( '5e0f52e1df1512d11df2bb4177597c6964c2e4cdd8e90163a7e9afd9f0deef44', 47325 ),
	'vo/f1-06-3-920ae8dfd8.mp3' => array( '5116ad4fbd2d8a2ec71048f7a5923c215db0a6ec724fa75d2bf77519aa1f964a', 24573 ),
	'vo/f1-06-5-9d85756903.mp3' => array( '46881e2ee1e2f0c13a738b2c946fea1e09c08e2aefcc2952df91644b9082a02b', 31053 ),
	'vo/f1-07-2-810f46105a.mp3' => array( '15fbc324bb0be472c012f1fbdfff1b85fe75c36a3951e4a54fb272f85e309f9f', 33933 ),
	'vo/f1-07-4-6c6cf701f0.mp3' => array( '916130b53bef9879777cc204f762d6c0107e47ae422470935fb53840b05e64b2', 15357 ),
	'vo/f1-07-6-6a1c6ced4a.mp3' => array( 'd9a3f3720f3af7d0a749238ba8cd56547015a38d29e255a749ef0eb963b149ec', 36669 ),
	'vo/f1-08-1-d1731e813f.mp3' => array( '0638ad6c1d45311a0039b99f53a55df5a5e0c949596875e7ea55091c915fe2b3', 42141 ),
	'vo/f1-08-2-f1dd3ed422.mp3' => array( 'fa8eaa0c7edb3cda2b2cced96a1c5e4e4256c12f6df1b99f690611070d441864', 30045 ),
	'vo/f1-08-3-2efc235f9c.mp3' => array( 'b7c2bcd4f43b097c82096e3648b65b9b6190095afdb1fe39aacfb3b5bddd5150', 34221 ),
	'vo/f1-09-1-e2fc038142.mp3' => array( '3c97818874f47e87eee255fabb6fa7c44024269549da6ec8934ac7d1f077304a', 40845 ),
	'vo/f1-09-3-4ac5fc723a.mp3' => array( '689d208b72bec75b6e65293b68a9051159dda88884dcbb4deaf324a7996e5050', 25437 ),
	'vo/f2-01-1-9176285344.mp3' => array( 'e4cef799465611f5e9a1712e05b026c380b6e5247852b52afcf731a05dd8d68e', 49485 ),
	'vo/f2-01-2-c5591910fd.mp3' => array( '6786902396919eef2d749652b15957c42becc64dc4165e7a52f80ae5325dec47', 21981 ),
	'vo/f2-02-1-657e007c88.mp3' => array( 'ebc3edd587ba31fac9b8280f413da1b925bbdd940c34f04da797f261ea0f1f8a', 29757 ),
	'vo/f2-03-1-26a12d399b.mp3' => array( '2bb5d47aecffaf7935dea78381299f8a063a5fc872f6b8c6e288c0bf40da8e9c', 31629 ),
	'vo/f2-03-2-d18f886bef.mp3' => array( 'edcf08f1f7d1ea467d84e6ae088d3f5ca107b01099c7cb831f08bdf97de38316', 33357 ),
	'vo/f2-03-3-31c7a5a55a.mp3' => array( '481d62f3b21e90cb0eb334d0488bc57f60a9226664a05b3b84c3b6733b93ee75', 20109 ),
	'vo/f2-04-1-6c5f3cf27b.mp3' => array( 'd29cac81cab1252d6ad7cf6e1ac140941433a1d046a29ea975452351bb4dfeac', 29325 ),
	'vo/f2-04-2-635ecc078c.mp3' => array( '21ca3425e532c9660c3d82facd0ec702e0f8b003454d709af4d9a05d3abe1d27', 17805 ),
	'vo/f2-04-3-23d07dc5f3.mp3' => array( 'b139a035af7cf5e76e962ea380aebcf2d64e5e7f5003bb45241c7a2219aa3dc5', 33645 ),
	'vo/f2-04-4-7ded1c15ea.mp3' => array( 'dfb02faac4fa01ae02464dbe56da13a846b9052b2af3565877bdc9baacb40e6c', 25869 ),
	'vo/f2-04-5-3082a3daf1.mp3' => array( 'cb4168c0063e9baea3688b1caa66dc6d3a47d23a594ad1ee51f51daf63a874f4', 17085 ),
	'vo/f2-05-1-425e0d1ec4.mp3' => array( '3cd37ee8e01867bd676ce78e627e197771e4586d2f185dcbe12d86dcbfe3d292', 48909 ),
	'vo/f2-05-2-67ab4ee24b.mp3' => array( '8a9caf11dbed2829b2a31d1f1e9b2416a8d2804b373a8d0d69e2d62bfad416f5', 18669 ),
	'vo/f2-06-1-247e067fe8.mp3' => array( '451ddcb73d71564418ab147642903464470dca075581f1633f7b301e86b5f435', 32349 ),
	'vo/f2-06-2-a80f61db0a.mp3' => array( 'b64af2b22b18fda5a2474097ff7c97509c9bea22d3f921ab9783d9d5c18ce0d5', 34077 ),
	'vo/f2-06-3-c935bc221a.mp3' => array( '8feb18ed51a9ed601c38c8236500442b3d729d648299c278f76c2fd788070600', 37965 ),
	'vo/f2-06-4-a4c96f7f72.mp3' => array( 'f5cc1ae9ac92f5cfa4a7a698f250094ae5681ccbf7c1257de41e700e4318fd34', 15501 ),
	'vo/f2-07-1-8f51435a80.mp3' => array( '45f4f73291815a32ca1c2a69efbba0b9c6f61aef4a3ebd3716a34a665b350fca', 42141 ),
	'vo/f2-07-2-ff4de61fc3.mp3' => array( '13dec50ccdc9fa8e542ef719104a4bb29ab46bc4fc07a93e580c4918b2008e23', 35085 ),
	'vo/f2-08-1-c8ecfc3996.mp3' => array( 'ec91ae1c0df2c4da397436a351e1eba8edb2f4f672b7d5ea987e1ebb093ae8d0', 37533 ),
	'vo/f2-08-2-dd506a76b8.mp3' => array( 'e5e0ee2545778ed2bbc54ebbd6c375b8156efc1b067025e258758e78c3862852', 28605 ),
	'vo/f2-08-3-69ba1260a8.mp3' => array( 'a659773162fb86f7253200736aa720a2830b11b2f5b09331839fc7fc88ce43cf', 25869 ),
	'vo/f2-08-4-290178c496.mp3' => array( '3ac14115597695297a8c9d53eabd1573a16677f583930039acd91f14c4fceb92', 28173 ),
	'vo/f2-08-5-56f51d1e32.mp3' => array( '98bc323c721d64d9b34152a37c687d597246dafb1e503cbb9378a382f6811b42', 33069 ),
	'vo/f2-08-6-b643da51b6.mp3' => array( 'df7056dd5f7f7e5fd148c64f9e3e414418cade0dae7a51180150bdbef66e49a8', 22701 ),
	'vo/f2-08-7-cc9307bc09.mp3' => array( '4bbee8c563d147c0e50d920cc1516f96247b2fcb95dd5cb36b0ceb75ea7b4906', 28029 ),
	'vo/f2-09-1-e5781bf6bb.mp3' => array( 'a61d9d89ca5a1d576f4f0d4076ff135c56820a15d4cac49ded125c47b67cbd71', 33933 ),
	'vo/f2-09-2-911c941a99.mp3' => array( '6b3f1928aed86e3aa83dc03803fb9b3f18556928070cbd9e27248ac2d00afcc3', 21981 ),
	'vo/f2-09-3-68ea53f31a.mp3' => array( 'de5e2983ea67453e13ce8093b856638cb4f89d50a2158a6595355d526945e0ff', 33789 ),
	'vo/f2-09-4-c1c7d2f99f.mp3' => array( 'c8546d78c818fdd0e17cc797c69d7159512187870c9e00c0f8c658389da46266', 41997 ),
	'vo/f2-09-5-6a8352b5c0.mp3' => array( '5679733f99e50abe40b74f02236e156fd959d8937a744265f64aee9add323e8f', 35949 ),
	'vo/f2-09-6-22794fbd27.mp3' => array( '7f915b0e4a66f4450fd0a7b2e8b30665d2c4d7f1ed56749e3d1975b9aa5b492e', 30909 ),
	'vo/f2-10-1-b814b1654a.mp3' => array( '8a303d59aaa8324e8765b14940eaf75f94740223eedf8d771fbcfa10fb1f9fe1', 44589 ),
	'vo/f2-10-2-9c3ee06e5f.mp3' => array( '19b8fa860ce4825e6370ee83645b46cd6fd22ad600191641b26f25727f2d89c1', 38541 ),
	'vo/f2-10-3-2dbaa4ce3a.mp3' => array( 'b533e3f8a24cd3e8d8573129acdcedda9b10846f7790ea4611a905123d430475', 28461 ),
	'vo/f3-01-1-37065610ec.mp3' => array( 'de2830aba0c1195353bf11253654db20d1bae4bdfb025db7409fd6d58841a8a9', 44013 ),
	'vo/f3-01-2-c8ac2db8d0.mp3' => array( '58b665d8f89de95be9b7eb9736691c599e6744200c2343ed9073defc40831474', 22557 ),
	'vo/f3-01-3-d4c36ad55f.mp3' => array( '28787d39d0569258f56cabc3c0a69d775fe687ed403064b7f737bbeb623573b2', 14637 ),
	'vo/f3-01-4-29c7f09a80.mp3' => array( '230a1b373b8a905ac16c47a2df93eec321e80f0b3be81c3b44fc09b88be63d5e', 15501 ),
	'vo/f3-02-1-6e79fb386e.mp3' => array( '58789a0e0ee12e242b2b0883139aa149e66a14bd5672cbd4a204786ae9c6cce1', 33069 ),
	'vo/f3-02-2-a74e98a958.mp3' => array( '8abd2ab7811bea1754c8fa4843c4cd660b7d5fd78f29305db068cf6a33ebbf60', 18957 ),
	'vo/f3-03-1-dd0f6353f2.mp3' => array( 'f3df2864ddd46b53768b390e71377b41d32f6fb00f895a289c53dde5f5cebbf7', 35517 ),
	'vo/f3-03-10-606602f200.mp3' => array( '13a0d63a79814c1122e34afeffd8a34a0819fa10c145fde1c8fae8441d6f26c5', 46461 ),
	'vo/f3-03-2-c8e634bfda.mp3' => array( '5ec811bf637ea021e4dadab32d5ed8323b7a1541a1da0440cfbc2065e1f93a6e', 21117 ),
	'vo/f3-03-3-26cc7e0c86.mp3' => array( 'd869985eda5fb31a97f996b512e76ca43cbdebab159f3d409d2ca76e6ce3efa6', 6285 ),
	'vo/f3-03-4-88fe559cf1.mp3' => array( '0e92ca5e0c705c77a1dfe53d87dab9dd1325c6645249928aba6abde9852493e3', 29181 ),
	'vo/f3-03-5-3ccd70bab6.mp3' => array( '608c7b973e46aaef9500036f8fbed54db7e8571dc20eb4d6d9fbbe9929cdeaa7', 21981 ),
	'vo/f3-03-6-afe88797ff.mp3' => array( '5e17f38d75865757c7c14ab6305a4e4dd757f7683bba72b007179f9b6e3c2292', 23421 ),
	'vo/f3-03-7-a006a59c81.mp3' => array( '9c8d06ddef520cb6f8e3edd80d803caaaed93968827359d477e368364a968e64', 23853 ),
	'vo/f3-03-8-1ba22cb949.mp3' => array( '05692d1e0c7d6e3a1272c82b6a21f62f4b28c9cd70bb403027611cf7a62cff0a', 19821 ),
	'vo/f3-03-9-28f1d27795.mp3' => array( 'e6ff5146fb1bf1f7e162126c01548f8738322551a4e598a3d8c3c870e0e7653d', 19677 ),
	'vo/f3-04-1-2be56ae48b.mp3' => array( 'a5cfdf1991de64861ddf59a1d6ab37181e5a5315ab2b550668323628a84c972b', 48477 ),
	'vo/f3-04-2-172960959d.mp3' => array( 'c72a5c2db6a93b2b3fec48f376ce20e2c9c17e8137efb917c8beaca5c86650af', 33213 ),
	'vo/f3-05-1-b8371cd8d9.mp3' => array( '29440993d1f7d5bf96de7ef85a3118f5c71050f92c41f450a2f8e3c27698fdf6', 47757 ),
	'vo/f3-05-2-4414f7c85a.mp3' => array( 'abf8ba50f2401024baac09d1c285c7899ff08db3cfc4fa0e2a7eb597ca53575f', 26589 ),
);
// rmn-golf v2 allow-list: end
/**
 * Run Your Own RMN walkthrough assets v3 (15 Nov 2026): the same network, but clubs differ in how many screens they have (1 to 12, from
 * tools/rmn-golf-tour/network.json) and inventory is sold by display type and the audience in front of it. Same scheme as v2, from
 * tour-assets/rmn-golf/v3/ (SHA256SUMS there), served at /run-your-own-rmn/tour/assets/v3/ and cached in uploads/ph-tour/rmn-golf/v3/.
 * v3 stays immutable (tour.html loads v4 since 15 Nov 2026); v1 to v3 can be retired once v4 is live.
 */
const TOUR_ASSET_PREFIX_RMN_V3     = '/run-your-own-rmn/tour/assets/v3/';
const TOUR_ASSET_REPO_URL_RMN_V3   = 'https://raw.githubusercontent.com/offline2online/rob_ph_demos/main/ph-website/tour-assets/rmn-golf/v3/';
const TOUR_ASSET_MIRROR_URL_RMN_V3 = 'https://cdn.jsdelivr.net/gh/offline2online/rob_ph_demos@main/ph-website/tour-assets/rmn-golf/v3/';
// rmn-golf v3 allow-list: start (generated by tools/rmn-golf-tour/allowlist.py)
const TOUR_ASSETS_RMN_V3 = array(
	'img/01-advertiser.jpg' => array( '05b22255b81ad10df9a2a1803ca8aefbc01bd6d08092f7bbca043218947061b6', 150964 ),
	'img/03-users.jpg' => array( 'fc0149eb690c1d196c1b28552dec5661de88532d8c0f85f4ee0b34a348368e9d', 75257 ),
	'img/04-add-user.jpg' => array( 'e331588b4786ff46c9eecee04fcb8761fd536a667291c25e700584741cc6f54f', 77687 ),
	'img/05-deals.jpg' => array( '530482ded5d0cda17f28bd944c0120c1807c1906b761312e817a52552a0a1856', 148202 ),
	'img/06-new-deal.jpg' => array( 'f086dc3b003df593620c6a0d424e74a5eec4f3cffa529ee3ed2370e9edba6a03', 139132 ),
	'img/07-assign-slot.jpg' => array( 'aca0682368d2c3aa3ebf376bbf3d36167af1a3fe0a6b63d0113a59635e34ef4a', 155481 ),
	'img/07a-blank.jpg' => array( '8d1a8c9dcc71245aae59d3e3e6671399fb69408e83226e9731eb8f08c58cf06f', 155119 ),
	'img/07b-assigned-all.jpg' => array( '08801d6141d5aafd3aa136e25837f9b0bd00924e25e59e3dcb222e6411ce3580', 153196 ),
	'img/07c1.jpg' => array( '419d1d642b19055c68da2b0c6c05106b5d03bd6125773ba8b96efe05feee7ead', 156949 ),
	'img/07c2.jpg' => array( '91a949fbe805f96e2f70568558a195a9b9fa0eec2acf52f92bcc729be3926439', 156124 ),
	'img/07c3.jpg' => array( 'c6105919ae2d0279faf747dcc9691e05dc31d8e54fcc246f0510bf020f168538', 155513 ),
	'img/07c4.jpg' => array( '3076db833e7596d7a1c8da2406821e12c347ee9267ba5b33f08bff1314491741', 154632 ),
	'img/07c5.jpg' => array( '99cb9c2fcaa1c7f0bf5d228c278f0a484d4734cd21482ca096986f865dbcfabd', 154202 ),
	'img/07d2.jpg' => array( '3f4986d3c4b50316c092815411e68dc3b3bbb962a4ccb508dfadadefff3a94ad', 155897 ),
	'img/07d3.jpg' => array( 'd6dfca2c00ef2c63137530d058832a5cf53cfd429ae1b8d88b49b5dc7ee63056', 155390 ),
	'img/07d4.jpg' => array( 'efed876dc32eaa739f7d87cfb37ffeebf4b66d8cbcb7860d3053617c869f38a3', 154528 ),
	'img/07d5.jpg' => array( 'ab5cc56f4f3e715bf4ccb13775c34b3e9f891ff5b218ab403e80b5167adfbc8d', 155117 ),
	'img/07d6.jpg' => array( '8792e0028c69bff1be4d20da5ce066659c805dd5f672dfc50929d4bbe39b7b2e', 153784 ),
	'img/08-deal-finalise.jpg' => array( '6ebe80544f5d1b7512d35cabd7db1be97c7b5f3e222eae8228b54b7d235d52f9', 142139 ),
	'img/09-deal-live.jpg' => array( 'f5bc3fcc4e635348f09ec3c13b54891faf95c967bfa8b3056a9ee03514f7d519', 144719 ),
	'img/14-approval-table.jpg' => array( '44ba40bdb4e979ed5535209768defc07b18aa1d1ec9e36d5094f6505d07e1eb6', 75914 ),
	'img/15-approve.jpg' => array( 'feed38ed3377b280d896c86c86f26c9bc9bb18de33d14c749b0abcccdb694a0f', 84673 ),
	'img/16-booking-schedule.jpg' => array( '396fbf7dd213f8d9ff02cdd7abad52e37a15c6efd00b970f3045640e290f3c6c', 205187 ),
	'img/16b-booking-flight.jpg' => array( '7c69b2d8e19005e53ee31d17a0c066805241fd239d36ab99e508e9737ac5536d', 176529 ),
	'img/22-booking-revenue.jpg' => array( 'cd73d21b4da240cab7cbecd24b65a43186f6abbe9f9fc6ef9cc91e7f54f4c991', 180360 ),
	'img/N0-stores.jpg' => array( 'a62404f6ba4d5006e1866c751cdbc180788885ece7139a3fefb8da3171b6377d', 158850 ),
	'img/P1-display-types.jpg' => array( 'faa1e20ac49f6efdb6b04b7e3c05d6613292615fdc06613241536edbdf2d5330', 103888 ),
	'img/P10-bar.jpg' => array( 'c6a7579f22660908fda71d01dcaf11f5b71122cedc63476d3a958c9eec776f78', 108879 ),
	'img/P11-saved.jpg' => array( '5e2c58f9b3e137e0fef3355d5ea348d423e3b82372c7a893a3dbe6b78a2f357b', 120665 ),
	'img/P2-playlists.jpg' => array( '8fb482ddfab8901314411006ba0b3a6c7976bdcdc8ad658707e80b394799552c', 98612 ),
	'img/P2b-expanded.jpg' => array( 'dad1e89bea28e4566affbb0101562e63a2fc8c704bf836fc7f029505f26e84de', 127048 ),
	'img/P3-three-slots.jpg' => array( '995431a1251fa663f40fde14b3383548e8c7bf5444b7007df0a0a90578aa5f66', 108261 ),
	'img/P4-owner.jpg' => array( '43aadf747d5891e1fafa540de992778f5549389f82f06572317d0c419091028e', 139598 ),
	'img/P4a-slots.jpg' => array( '85976953f83983d19e55e6b34203bcef44b887cf8c4cc0c5d9b002e7ffd7a0ec', 140874 ),
	'img/P5-proshop.jpg' => array( 'bbf12c3d27c2401952b794c6b258e656fdfa82b21ad8c992ee02551cd993950a', 141079 ),
	'img/P6-range.jpg' => array( '5330a48d70109e3cef349204be4b10210bd87db92c0bf12fcec98e11948743ef', 135080 ),
	'img/P7-tee.jpg' => array( '1a2ba20d1abfa61240843d4cc39d4fbc811dcf08d9b9b0dc7b75fe5ca4a22fbe', 129067 ),
	'img/P8-halfway.jpg' => array( '90d7bdb64a795b6fb0d6b527c2913ba8ce935f686bfbbff1ed4685b30659d037', 122287 ),
	'img/P9-locker.jpg' => array( 'f7b6e083372071c156abd52daaff86c81716557863904c1118d0769eb22af1f7', 115345 ),
	'img/login-bg.jpg' => array( 'c2f822cd33039b3a27c1665c98fd8c87b8a90ff6f408bd5dfd754fe1d0282b0c', 11605 ),
	'vo/f1-01-1-e84cc60ed7.mp3' => array( '0c91e75d5c2ca8170f77e3b91965bc99fd9ab2709b0042630af14ca200ce3e53', 44301 ),
	'vo/f1-01-2-1ab9a4d38f.mp3' => array( 'bfda6e2152b78bdd67b0e88835cf95fc97338ae7a8d43dc310378dd4b6b5b87d', 23421 ),
	'vo/f1-01-3-9c383f6d9a.mp3' => array( 'f1e0ab7d0346e83534d36d85abd290251c7a2828a14ff5a092f990c385544422', 20685 ),
	'vo/f1-02-1-019cfa9967.mp3' => array( 'c6cc8614579805501509fff32a614467ba101e6c1e34cfe375dba131b98b6834', 10893 ),
	'vo/f1-02-1-221346bfd1.mp3' => array( 'f3ba2a6c1d1f43de69fb076673b0137ccb92dd8cee8640ad49cf38c21a0b5129', 49053 ),
	'vo/f1-02-2-180af5891f.mp3' => array( 'ef3257fa62fa33d8ecfb45f00f858b20acfdad8df483160598ab39623713d54f', 22845 ),
	'vo/f1-02-2-6a04d41418.mp3' => array( 'cbd4a1ebc6708035bcb6c9725075a8bae31c8d78488c0663b7a667d70d581d07', 30477 ),
	'vo/f1-02-5-9f9d0e125b.mp3' => array( 'e79e38fee13f9596603f5490d391afa54740ba19afd12309121960d80c39a83e', 18669 ),
	'vo/f1-03-1-1e0d92d0f9.mp3' => array( '1da7e582d51e9807329e18acc1e4d0a51edbcc1d4af32b11db650ff0e3435806', 41133 ),
	'vo/f1-03-3-55882e5b2f.mp3' => array( '4fa6d8a683e831b7c566fe6a3ed6280921d4b22de4795b101b9b4550c1d37428', 23565 ),
	'vo/f1-03-4-da72026f43.mp3' => array( 'c8c34e672106078ecd65e90e40ab862f037400d3164999099cf00774d4289cb8', 18381 ),
	'vo/f1-03-6-cb8d8c67db.mp3' => array( '82ce5c05099e8aa9412d22108f9ca569ba1ffef9daf95b6a0b307cfccdd73f97', 33789 ),
	'vo/f1-04-2-f9f36c2353.mp3' => array( '08eddf8319ef4ee6b38c86e864faf5d9c9c7dff2a5b0bbf223767f82bdf78707', 20685 ),
	'vo/f1-04-3-2663b2fc06.mp3' => array( 'f4ad8fd1f9e7dade31f4e2d9cf0ea646c98dc84e4054e8fe9f776ab98840d685', 45453 ),
	'vo/f1-05-1-30a14d7532.mp3' => array( '95842fe97d15051ab8485ac709be6c75aebffde323939f7330a85cb5083bc3c9', 31773 ),
	'vo/f1-05-1-815ef1fcf7.mp3' => array( 'd5f8b20c7edbaa1de03d3a6719d913104b4fa6679b6382e045aa898b8340c3b3', 30189 ),
	'vo/f1-06-1-65160b6df7.mp3' => array( '3c8775380dafb48d255f1a5e59be01e17a49ee0791f456cc4de41e483fc512ae', 27453 ),
	'vo/f1-06-2-640f60c26e.mp3' => array( 'c54e494d9dbc4abcdb5f3df15d93ad65b900db7e08780346c7ed9cd494a33ad2', 33357 ),
	'vo/f1-06-2-a2b377b099.mp3' => array( '46fece91c25d29f7e2d6de5ade329659ae72bac91b80ed66b1656b2d41ecca77', 23709 ),
	'vo/f1-07-3-2253be85b7.mp3' => array( '7064d0b7a165633d0d770d8455361cb9e61921bf7b227e0a8a0647fa9ddf5d89', 19677 ),
	'vo/f1-07-4-6c6cf701f0.mp3' => array( '916130b53bef9879777cc204f762d6c0107e47ae422470935fb53840b05e64b2', 15357 ),
	'vo/f1-07-6-c3e916080f.mp3' => array( '57d6e7e04600c7741d4d5addb245856ee2ab3cafe92a4508a2abf76173a8d068', 40413 ),
	'vo/f1-08-1-8992769528.mp3' => array( '018e1a6bd23afb157fdd289a5465416ef7944cf642eddefebec2b0b0ddbfd927', 40989 ),
	'vo/f1-08-2-3acee6a3d0.mp3' => array( 'a01d8477a4b498e1d535071942f306b703d5540b21b080012fc5fbcaa9ced9b8', 40413 ),
	'vo/f1-08-2-f1dd3ed422.mp3' => array( 'fa8eaa0c7edb3cda2b2cced96a1c5e4e4256c12f6df1b99f690611070d441864', 30045 ),
	'vo/f1-08-3-28d3a1cad3.mp3' => array( '1a32681f3cab988ef0ea7b1ce505dc464e1d42268cf3cc84ec979ec8f1ef500b', 33501 ),
	'vo/f1-09-1-e2fc038142.mp3' => array( '3c97818874f47e87eee255fabb6fa7c44024269549da6ec8934ac7d1f077304a', 40845 ),
	'vo/f1-09-3-4ac5fc723a.mp3' => array( '689d208b72bec75b6e65293b68a9051159dda88884dcbb4deaf324a7996e5050', 25437 ),
	'vo/f2-01-1-9176285344.mp3' => array( 'e4cef799465611f5e9a1712e05b026c380b6e5247852b52afcf731a05dd8d68e', 49485 ),
	'vo/f2-01-2-c5591910fd.mp3' => array( '6786902396919eef2d749652b15957c42becc64dc4165e7a52f80ae5325dec47', 21981 ),
	'vo/f2-02-1-657e007c88.mp3' => array( 'ebc3edd587ba31fac9b8280f413da1b925bbdd940c34f04da797f261ea0f1f8a', 29757 ),
	'vo/f2-03-1-26a12d399b.mp3' => array( '2bb5d47aecffaf7935dea78381299f8a063a5fc872f6b8c6e288c0bf40da8e9c', 31629 ),
	'vo/f2-03-2-d18f886bef.mp3' => array( 'edcf08f1f7d1ea467d84e6ae088d3f5ca107b01099c7cb831f08bdf97de38316', 33357 ),
	'vo/f2-03-3-31c7a5a55a.mp3' => array( '481d62f3b21e90cb0eb334d0488bc57f60a9226664a05b3b84c3b6733b93ee75', 20109 ),
	'vo/f2-04-1-6c5f3cf27b.mp3' => array( 'd29cac81cab1252d6ad7cf6e1ac140941433a1d046a29ea975452351bb4dfeac', 29325 ),
	'vo/f2-04-2-635ecc078c.mp3' => array( '21ca3425e532c9660c3d82facd0ec702e0f8b003454d709af4d9a05d3abe1d27', 17805 ),
	'vo/f2-04-3-23d07dc5f3.mp3' => array( 'b139a035af7cf5e76e962ea380aebcf2d64e5e7f5003bb45241c7a2219aa3dc5', 33645 ),
	'vo/f2-04-4-7ded1c15ea.mp3' => array( 'dfb02faac4fa01ae02464dbe56da13a846b9052b2af3565877bdc9baacb40e6c', 25869 ),
	'vo/f2-04-5-3fef2f564a.mp3' => array( '21ed395f91faacde2cac5d958be556eb61152d6efd36d91f715b01c5298d8d72', 27021 ),
	'vo/f2-05-1-425e0d1ec4.mp3' => array( '3cd37ee8e01867bd676ce78e627e197771e4586d2f185dcbe12d86dcbfe3d292', 48909 ),
	'vo/f2-05-2-67ab4ee24b.mp3' => array( '8a9caf11dbed2829b2a31d1f1e9b2416a8d2804b373a8d0d69e2d62bfad416f5', 18669 ),
	'vo/f2-06-1-247e067fe8.mp3' => array( '451ddcb73d71564418ab147642903464470dca075581f1633f7b301e86b5f435', 32349 ),
	'vo/f2-06-2-a80f61db0a.mp3' => array( 'b64af2b22b18fda5a2474097ff7c97509c9bea22d3f921ab9783d9d5c18ce0d5', 34077 ),
	'vo/f2-06-3-c935bc221a.mp3' => array( '8feb18ed51a9ed601c38c8236500442b3d729d648299c278f76c2fd788070600', 37965 ),
	'vo/f2-06-4-a4c96f7f72.mp3' => array( 'f5cc1ae9ac92f5cfa4a7a698f250094ae5681ccbf7c1257de41e700e4318fd34', 15501 ),
	'vo/f2-07-1-8f51435a80.mp3' => array( '45f4f73291815a32ca1c2a69efbba0b9c6f61aef4a3ebd3716a34a665b350fca', 42141 ),
	'vo/f2-07-2-ff4de61fc3.mp3' => array( '13dec50ccdc9fa8e542ef719104a4bb29ab46bc4fc07a93e580c4918b2008e23', 35085 ),
	'vo/f2-08-1-5f00d19707.mp3' => array( '3121a191dab8b6591d02664ea8f03fa43fd9d153d7f1380732699aa7e29902fc', 42573 ),
	'vo/f2-08-2-dd506a76b8.mp3' => array( 'e5e0ee2545778ed2bbc54ebbd6c375b8156efc1b067025e258758e78c3862852', 28605 ),
	'vo/f2-08-3-69ba1260a8.mp3' => array( 'a659773162fb86f7253200736aa720a2830b11b2f5b09331839fc7fc88ce43cf', 25869 ),
	'vo/f2-08-4-290178c496.mp3' => array( '3ac14115597695297a8c9d53eabd1573a16677f583930039acd91f14c4fceb92', 28173 ),
	'vo/f2-08-5-56f51d1e32.mp3' => array( '98bc323c721d64d9b34152a37c687d597246dafb1e503cbb9378a382f6811b42', 33069 ),
	'vo/f2-08-6-b643da51b6.mp3' => array( 'df7056dd5f7f7e5fd148c64f9e3e414418cade0dae7a51180150bdbef66e49a8', 22701 ),
	'vo/f2-08-7-cc9307bc09.mp3' => array( '4bbee8c563d147c0e50d920cc1516f96247b2fcb95dd5cb36b0ceb75ea7b4906', 28029 ),
	'vo/f2-09-1-e5781bf6bb.mp3' => array( 'a61d9d89ca5a1d576f4f0d4076ff135c56820a15d4cac49ded125c47b67cbd71', 33933 ),
	'vo/f2-09-2-911c941a99.mp3' => array( '6b3f1928aed86e3aa83dc03803fb9b3f18556928070cbd9e27248ac2d00afcc3', 21981 ),
	'vo/f2-09-3-68ea53f31a.mp3' => array( 'de5e2983ea67453e13ce8093b856638cb4f89d50a2158a6595355d526945e0ff', 33789 ),
	'vo/f2-09-4-c1c7d2f99f.mp3' => array( 'c8546d78c818fdd0e17cc797c69d7159512187870c9e00c0f8c658389da46266', 41997 ),
	'vo/f2-09-5-6a8352b5c0.mp3' => array( '5679733f99e50abe40b74f02236e156fd959d8937a744265f64aee9add323e8f', 35949 ),
	'vo/f2-09-6-22794fbd27.mp3' => array( '7f915b0e4a66f4450fd0a7b2e8b30665d2c4d7f1ed56749e3d1975b9aa5b492e', 30909 ),
	'vo/f2-10-1-b814b1654a.mp3' => array( '8a303d59aaa8324e8765b14940eaf75f94740223eedf8d771fbcfa10fb1f9fe1', 44589 ),
	'vo/f2-10-2-9c3ee06e5f.mp3' => array( '19b8fa860ce4825e6370ee83645b46cd6fd22ad600191641b26f25727f2d89c1', 38541 ),
	'vo/f2-10-3-2dbaa4ce3a.mp3' => array( 'b533e3f8a24cd3e8d8573129acdcedda9b10846f7790ea4611a905123d430475', 28461 ),
	'vo/f3-01-1-0d9073fe2a.mp3' => array( 'c414515ff43e64c4f2a71364eaf3fbfdbebf16e47f6a831a54c6a5dbde63dde3', 49485 ),
	'vo/f3-01-2-c8ac2db8d0.mp3' => array( '58b665d8f89de95be9b7eb9736691c599e6744200c2343ed9073defc40831474', 22557 ),
	'vo/f3-01-3-d4c36ad55f.mp3' => array( '28787d39d0569258f56cabc3c0a69d775fe687ed403064b7f737bbeb623573b2', 14637 ),
	'vo/f3-01-4-29c7f09a80.mp3' => array( '230a1b373b8a905ac16c47a2df93eec321e80f0b3be81c3b44fc09b88be63d5e', 15501 ),
	'vo/f3-02-1-6e79fb386e.mp3' => array( '58789a0e0ee12e242b2b0883139aa149e66a14bd5672cbd4a204786ae9c6cce1', 33069 ),
	'vo/f3-02-2-a74e98a958.mp3' => array( '8abd2ab7811bea1754c8fa4843c4cd660b7d5fd78f29305db068cf6a33ebbf60', 18957 ),
	'vo/f3-03-1-dd0f6353f2.mp3' => array( 'f3df2864ddd46b53768b390e71377b41d32f6fb00f895a289c53dde5f5cebbf7', 35517 ),
	'vo/f3-03-10-524f9be195.mp3' => array( 'fa004f4d386191d20074b2368a960b413150d9743b5560c1caa09727cd0dfb27', 49917 ),
	'vo/f3-03-2-c8e634bfda.mp3' => array( '5ec811bf637ea021e4dadab32d5ed8323b7a1541a1da0440cfbc2065e1f93a6e', 21117 ),
	'vo/f3-03-3-26cc7e0c86.mp3' => array( 'd869985eda5fb31a97f996b512e76ca43cbdebab159f3d409d2ca76e6ce3efa6', 6285 ),
	'vo/f3-03-4-88fe559cf1.mp3' => array( '0e92ca5e0c705c77a1dfe53d87dab9dd1325c6645249928aba6abde9852493e3', 29181 ),
	'vo/f3-03-5-3ccd70bab6.mp3' => array( '608c7b973e46aaef9500036f8fbed54db7e8571dc20eb4d6d9fbbe9929cdeaa7', 21981 ),
	'vo/f3-03-6-afe88797ff.mp3' => array( '5e17f38d75865757c7c14ab6305a4e4dd757f7683bba72b007179f9b6e3c2292', 23421 ),
	'vo/f3-03-7-a006a59c81.mp3' => array( '9c8d06ddef520cb6f8e3edd80d803caaaed93968827359d477e368364a968e64', 23853 ),
	'vo/f3-03-8-1ba22cb949.mp3' => array( '05692d1e0c7d6e3a1272c82b6a21f62f4b28c9cd70bb403027611cf7a62cff0a', 19821 ),
	'vo/f3-03-9-28f1d27795.mp3' => array( 'e6ff5146fb1bf1f7e162126c01548f8738322551a4e598a3d8c3c870e0e7653d', 19677 ),
	'vo/f3-04-1-4165dd272b.mp3' => array( '1d70833a240dcee5787721855730986bcba717102a4c3aae11410b9f5c21524c', 47757 ),
	'vo/f3-04-2-172960959d.mp3' => array( 'c72a5c2db6a93b2b3fec48f376ce20e2c9c17e8137efb917c8beaca5c86650af', 33213 ),
	'vo/f3-05-1-407ce7910e.mp3' => array( 'bd14645c8f659f5c32944352cb415d64665f919044fface4ed60e0e77dab89f7', 50781 ),
	'vo/f3-05-2-3f9c748bd4.mp3' => array( 'fe39d39e74d72db340273192fa263dd604b6553ff3bc87b1fda73d439eb7b30d', 27885 ),
);
// rmn-golf v3 allow-list: end
/**
 * Run Your Own RMN walkthrough assets v4 (15 Nov 2026): the same network, but every club has 2 to 16 screens and its own mix of the six
 * display types (tools/rmn-golf-tour/network.json), so Stores / Branches, Display Types, the deal's reach and the booking screens were
 * re-captured. Same scheme as v3, from tour-assets/rmn-golf/v4/ (SHA256SUMS there), served at /run-your-own-rmn/tour/assets/v4/ and
 * cached in uploads/ph-tour/rmn-golf/v4/. tour.html loads v4; v1 to v3 stay immutable and can be retired once v4 is live.
 */
const TOUR_ASSET_PREFIX_RMN_V4     = '/run-your-own-rmn/tour/assets/v4/';
const TOUR_ASSET_REPO_URL_RMN_V4   = 'https://raw.githubusercontent.com/offline2online/rob_ph_demos/main/ph-website/tour-assets/rmn-golf/v4/';
const TOUR_ASSET_MIRROR_URL_RMN_V4 = 'https://cdn.jsdelivr.net/gh/offline2online/rob_ph_demos@main/ph-website/tour-assets/rmn-golf/v4/';
// rmn-golf v4 allow-list: start (generated by tools/rmn-golf-tour/allowlist.py)
const TOUR_ASSETS_RMN_V4 = array(
	'img/01-advertiser.jpg' => array( 'c108fff5ead67ef9eee36e9e5923247aaf9e2ece7296169fde46055ca1720af2', 150894 ),
	'img/03-users.jpg' => array( 'fc0149eb690c1d196c1b28552dec5661de88532d8c0f85f4ee0b34a348368e9d', 75257 ),
	'img/04-add-user.jpg' => array( 'e331588b4786ff46c9eecee04fcb8761fd536a667291c25e700584741cc6f54f', 77687 ),
	'img/05-deals.jpg' => array( '1fde1590853a4fa59c4560e873d108ee42f9aace1cb2448e8e06861d831e27b3', 148059 ),
	'img/06-new-deal.jpg' => array( '47dd5c6bf7faee4264213d7047ce744bd3f59d50d2183d58f1e35cc61019910c', 139041 ),
	'img/07-assign-slot.jpg' => array( '1e276d52007cae28c1c88170afa3dbc0a1d1f0cff1abe82308422f799c8ad53f', 155444 ),
	'img/07a-blank.jpg' => array( 'b7eef93664575f68004076691417856879f585c6f688328acfbb61f871be5a03', 154969 ),
	'img/07b-assigned-all.jpg' => array( 'f0d13ed96910360a09821deeea0f40b416c9f06e17954d225417339bcf9225b4', 153047 ),
	'img/07c1.jpg' => array( 'cfaae8c44bf305149bb7c420eb943d6e1d47169636e3cf83984984af41a689b3', 156808 ),
	'img/07c2.jpg' => array( 'b7c90cc8783cf59aa1ae0e6f30d3162d697b73cc23f52bca2215164fb81f8553', 156015 ),
	'img/07c3.jpg' => array( 'e28f2362e0aa91802ec8e1fbcfbb77b25fd62ab8ba4bd111e205061b5caff9fa', 155322 ),
	'img/07c4.jpg' => array( 'b6520a303afb0e66d70b6d5d00f07791064b68f09504c9dc6329375fc4fcd185', 154413 ),
	'img/07c5.jpg' => array( '8f99a358371b9b187022d548f9fecd9d05e323902987edea07a425540a6527d4', 153989 ),
	'img/07d2.jpg' => array( 'b2a2445fac80ec6c3d1d45248dbc264ce77562d028ed9ebd4b4429fbdeca034b', 155698 ),
	'img/07d3.jpg' => array( '1f0464bb3e77b5347261bd7933181dc4f7cf06d94e6540d154f1bf3ec783292d', 155349 ),
	'img/07d4.jpg' => array( '6128a72f5e26607054d08a5182339ba40fa59040094fd932e79b3adbe8cdf6b1', 154428 ),
	'img/07d5.jpg' => array( '9987814e83168879e2fb2dba72bd3db278d694f5930a2b4636139f9d846ba728', 154871 ),
	'img/07d6.jpg' => array( 'f2cb754b91a34e0670f803ed8e147c108edd260b86a4b2f0ef7b0d1b711b8f89', 153627 ),
	'img/08-deal-finalise.jpg' => array( '882ac253fc92beae7c7ab0e9357b231995a0b5f22d0467c64f655eb4f178845a', 142197 ),
	'img/09-deal-live.jpg' => array( 'f43b8b82ee31cbeff35e2fc0787cc4cac1a7a6aabc6014bc2ff018843566f5da', 144548 ),
	'img/14-approval-table.jpg' => array( '44ba40bdb4e979ed5535209768defc07b18aa1d1ec9e36d5094f6505d07e1eb6', 75914 ),
	'img/15-approve.jpg' => array( 'feed38ed3377b280d896c86c86f26c9bc9bb18de33d14c749b0abcccdb694a0f', 84673 ),
	'img/16-booking-schedule.jpg' => array( 'a20f2ec0c11327d2adc527a53f711214641e75d6e58f267724bd0e9731af86ae', 206014 ),
	'img/16b-booking-flight.jpg' => array( '0dca7cc2c64e78fda52f05cdf80902bc705b4affa2376d0ecfa84311a8182324', 177168 ),
	'img/22-booking-revenue.jpg' => array( '8f334f862b5156bf28b9639ed795b4a1c79dc5f27ca0712a4083285004ba7905', 181667 ),
	'img/N0-stores.jpg' => array( '515093020f5cafe6f306c2fa88fbea89ab7747ab16ad1640d47deac2ce8c72f9', 159553 ),
	'img/P1-display-types.jpg' => array( 'faa1e20ac49f6efdb6b04b7e3c05d6613292615fdc06613241536edbdf2d5330', 103888 ),
	'img/P10-bar.jpg' => array( '9ea9b17e38899a0c774c198311270f12e020245caceac3cc72a32752bacc764d', 107469 ),
	'img/P11-saved.jpg' => array( '5e2c58f9b3e137e0fef3355d5ea348d423e3b82372c7a893a3dbe6b78a2f357b', 120665 ),
	'img/P2-playlists.jpg' => array( '8fb482ddfab8901314411006ba0b3a6c7976bdcdc8ad658707e80b394799552c', 98612 ),
	'img/P2b-expanded.jpg' => array( 'dad1e89bea28e4566affbb0101562e63a2fc8c704bf836fc7f029505f26e84de', 127048 ),
	'img/P3-three-slots.jpg' => array( '995431a1251fa663f40fde14b3383548e8c7bf5444b7007df0a0a90578aa5f66', 108261 ),
	'img/P4-owner.jpg' => array( '43aadf747d5891e1fafa540de992778f5549389f82f06572317d0c419091028e', 139598 ),
	'img/P4a-slots.jpg' => array( '85976953f83983d19e55e6b34203bcef44b887cf8c4cc0c5d9b002e7ffd7a0ec', 140874 ),
	'img/P5-proshop.jpg' => array( '0c82bb5e190387720e64bcf5efe99c1ff486378780e4dfaacd1cc09904a81ade', 139714 ),
	'img/P6-range.jpg' => array( '9ff6b895fafdd09af56a25bfd9096428c8430adef86deef9b8dfa8eb03777718', 133710 ),
	'img/P7-tee.jpg' => array( '7944fac2214f96dd1f85e6dd2eeb9eca85883031ba8cca049d6eb2b51da47a01', 127773 ),
	'img/P8-halfway.jpg' => array( '706b9560304c901c170c5c610177641fbac85f8db036457445d890244e50cd56', 120874 ),
	'img/P9-locker.jpg' => array( 'c1cd2d652a1bc64ecc8b6775769d87c01e0ed7b15590b5eaceb509bd015e4a28', 114032 ),
	'img/login-bg.jpg' => array( 'c2f822cd33039b3a27c1665c98fd8c87b8a90ff6f408bd5dfd754fe1d0282b0c', 11605 ),
	'vo/f1-01-1-e84cc60ed7.mp3' => array( '0c91e75d5c2ca8170f77e3b91965bc99fd9ab2709b0042630af14ca200ce3e53', 44301 ),
	'vo/f1-01-2-246dbb3133.mp3' => array( '6f3f439aaf11a3340ed86aa1d639c2cb2fa1ea3b172716018c06294645755312', 36957 ),
	'vo/f1-01-3-9c383f6d9a.mp3' => array( 'f1e0ab7d0346e83534d36d85abd290251c7a2828a14ff5a092f990c385544422', 20685 ),
	'vo/f1-02-1-019cfa9967.mp3' => array( 'c6cc8614579805501509fff32a614467ba101e6c1e34cfe375dba131b98b6834', 10893 ),
	'vo/f1-02-1-221346bfd1.mp3' => array( 'f3ba2a6c1d1f43de69fb076673b0137ccb92dd8cee8640ad49cf38c21a0b5129', 49053 ),
	'vo/f1-02-2-180af5891f.mp3' => array( 'ef3257fa62fa33d8ecfb45f00f858b20acfdad8df483160598ab39623713d54f', 22845 ),
	'vo/f1-02-2-6a04d41418.mp3' => array( 'cbd4a1ebc6708035bcb6c9725075a8bae31c8d78488c0663b7a667d70d581d07', 30477 ),
	'vo/f1-02-5-9f9d0e125b.mp3' => array( 'e79e38fee13f9596603f5490d391afa54740ba19afd12309121960d80c39a83e', 18669 ),
	'vo/f1-03-1-1e0d92d0f9.mp3' => array( '1da7e582d51e9807329e18acc1e4d0a51edbcc1d4af32b11db650ff0e3435806', 41133 ),
	'vo/f1-03-3-55882e5b2f.mp3' => array( '4fa6d8a683e831b7c566fe6a3ed6280921d4b22de4795b101b9b4550c1d37428', 23565 ),
	'vo/f1-03-4-da72026f43.mp3' => array( 'c8c34e672106078ecd65e90e40ab862f037400d3164999099cf00774d4289cb8', 18381 ),
	'vo/f1-03-6-cb8d8c67db.mp3' => array( '82ce5c05099e8aa9412d22108f9ca569ba1ffef9daf95b6a0b307cfccdd73f97', 33789 ),
	'vo/f1-04-2-f9f36c2353.mp3' => array( '08eddf8319ef4ee6b38c86e864faf5d9c9c7dff2a5b0bbf223767f82bdf78707', 20685 ),
	'vo/f1-04-3-2663b2fc06.mp3' => array( 'f4ad8fd1f9e7dade31f4e2d9cf0ea646c98dc84e4054e8fe9f776ab98840d685', 45453 ),
	'vo/f1-05-1-30a14d7532.mp3' => array( '95842fe97d15051ab8485ac709be6c75aebffde323939f7330a85cb5083bc3c9', 31773 ),
	'vo/f1-05-1-815ef1fcf7.mp3' => array( 'd5f8b20c7edbaa1de03d3a6719d913104b4fa6679b6382e045aa898b8340c3b3', 30189 ),
	'vo/f1-06-1-65160b6df7.mp3' => array( '3c8775380dafb48d255f1a5e59be01e17a49ee0791f456cc4de41e483fc512ae', 27453 ),
	'vo/f1-06-2-640f60c26e.mp3' => array( 'c54e494d9dbc4abcdb5f3df15d93ad65b900db7e08780346c7ed9cd494a33ad2', 33357 ),
	'vo/f1-06-2-a2b377b099.mp3' => array( '46fece91c25d29f7e2d6de5ade329659ae72bac91b80ed66b1656b2d41ecca77', 23709 ),
	'vo/f1-07-3-2253be85b7.mp3' => array( '7064d0b7a165633d0d770d8455361cb9e61921bf7b227e0a8a0647fa9ddf5d89', 19677 ),
	'vo/f1-07-4-6c6cf701f0.mp3' => array( '916130b53bef9879777cc204f762d6c0107e47ae422470935fb53840b05e64b2', 15357 ),
	'vo/f1-07-6-c3e916080f.mp3' => array( '57d6e7e04600c7741d4d5addb245856ee2ab3cafe92a4508a2abf76173a8d068', 40413 ),
	'vo/f1-08-1-8992769528.mp3' => array( '018e1a6bd23afb157fdd289a5465416ef7944cf642eddefebec2b0b0ddbfd927', 40989 ),
	'vo/f1-08-2-3acee6a3d0.mp3' => array( 'a01d8477a4b498e1d535071942f306b703d5540b21b080012fc5fbcaa9ced9b8', 40413 ),
	'vo/f1-08-2-f1dd3ed422.mp3' => array( 'fa8eaa0c7edb3cda2b2cced96a1c5e4e4256c12f6df1b99f690611070d441864', 30045 ),
	'vo/f1-08-3-28d3a1cad3.mp3' => array( '1a32681f3cab988ef0ea7b1ce505dc464e1d42268cf3cc84ec979ec8f1ef500b', 33501 ),
	'vo/f1-09-1-e2fc038142.mp3' => array( '3c97818874f47e87eee255fabb6fa7c44024269549da6ec8934ac7d1f077304a', 40845 ),
	'vo/f1-09-3-4ac5fc723a.mp3' => array( '689d208b72bec75b6e65293b68a9051159dda88884dcbb4deaf324a7996e5050', 25437 ),
	'vo/f2-01-1-9176285344.mp3' => array( 'e4cef799465611f5e9a1712e05b026c380b6e5247852b52afcf731a05dd8d68e', 49485 ),
	'vo/f2-01-2-c5591910fd.mp3' => array( '6786902396919eef2d749652b15957c42becc64dc4165e7a52f80ae5325dec47', 21981 ),
	'vo/f2-02-1-657e007c88.mp3' => array( 'ebc3edd587ba31fac9b8280f413da1b925bbdd940c34f04da797f261ea0f1f8a', 29757 ),
	'vo/f2-03-1-26a12d399b.mp3' => array( '2bb5d47aecffaf7935dea78381299f8a063a5fc872f6b8c6e288c0bf40da8e9c', 31629 ),
	'vo/f2-03-2-d18f886bef.mp3' => array( 'edcf08f1f7d1ea467d84e6ae088d3f5ca107b01099c7cb831f08bdf97de38316', 33357 ),
	'vo/f2-03-3-31c7a5a55a.mp3' => array( '481d62f3b21e90cb0eb334d0488bc57f60a9226664a05b3b84c3b6733b93ee75', 20109 ),
	'vo/f2-04-1-6c5f3cf27b.mp3' => array( 'd29cac81cab1252d6ad7cf6e1ac140941433a1d046a29ea975452351bb4dfeac', 29325 ),
	'vo/f2-04-2-635ecc078c.mp3' => array( '21ca3425e532c9660c3d82facd0ec702e0f8b003454d709af4d9a05d3abe1d27', 17805 ),
	'vo/f2-04-3-23d07dc5f3.mp3' => array( 'b139a035af7cf5e76e962ea380aebcf2d64e5e7f5003bb45241c7a2219aa3dc5', 33645 ),
	'vo/f2-04-4-7ded1c15ea.mp3' => array( 'dfb02faac4fa01ae02464dbe56da13a846b9052b2af3565877bdc9baacb40e6c', 25869 ),
	'vo/f2-04-5-3fef2f564a.mp3' => array( '21ed395f91faacde2cac5d958be556eb61152d6efd36d91f715b01c5298d8d72', 27021 ),
	'vo/f2-05-1-425e0d1ec4.mp3' => array( '3cd37ee8e01867bd676ce78e627e197771e4586d2f185dcbe12d86dcbfe3d292', 48909 ),
	'vo/f2-05-2-67ab4ee24b.mp3' => array( '8a9caf11dbed2829b2a31d1f1e9b2416a8d2804b373a8d0d69e2d62bfad416f5', 18669 ),
	'vo/f2-06-1-247e067fe8.mp3' => array( '451ddcb73d71564418ab147642903464470dca075581f1633f7b301e86b5f435', 32349 ),
	'vo/f2-06-2-a80f61db0a.mp3' => array( 'b64af2b22b18fda5a2474097ff7c97509c9bea22d3f921ab9783d9d5c18ce0d5', 34077 ),
	'vo/f2-06-3-c935bc221a.mp3' => array( '8feb18ed51a9ed601c38c8236500442b3d729d648299c278f76c2fd788070600', 37965 ),
	'vo/f2-06-4-a4c96f7f72.mp3' => array( 'f5cc1ae9ac92f5cfa4a7a698f250094ae5681ccbf7c1257de41e700e4318fd34', 15501 ),
	'vo/f2-07-1-8f51435a80.mp3' => array( '45f4f73291815a32ca1c2a69efbba0b9c6f61aef4a3ebd3716a34a665b350fca', 42141 ),
	'vo/f2-07-2-ff4de61fc3.mp3' => array( '13dec50ccdc9fa8e542ef719104a4bb29ab46bc4fc07a93e580c4918b2008e23', 35085 ),
	'vo/f2-08-1-5f00d19707.mp3' => array( '3121a191dab8b6591d02664ea8f03fa43fd9d153d7f1380732699aa7e29902fc', 42573 ),
	'vo/f2-08-2-dd506a76b8.mp3' => array( 'e5e0ee2545778ed2bbc54ebbd6c375b8156efc1b067025e258758e78c3862852', 28605 ),
	'vo/f2-08-3-69ba1260a8.mp3' => array( 'a659773162fb86f7253200736aa720a2830b11b2f5b09331839fc7fc88ce43cf', 25869 ),
	'vo/f2-08-4-290178c496.mp3' => array( '3ac14115597695297a8c9d53eabd1573a16677f583930039acd91f14c4fceb92', 28173 ),
	'vo/f2-08-5-56f51d1e32.mp3' => array( '98bc323c721d64d9b34152a37c687d597246dafb1e503cbb9378a382f6811b42', 33069 ),
	'vo/f2-08-6-b643da51b6.mp3' => array( 'df7056dd5f7f7e5fd148c64f9e3e414418cade0dae7a51180150bdbef66e49a8', 22701 ),
	'vo/f2-08-7-cc9307bc09.mp3' => array( '4bbee8c563d147c0e50d920cc1516f96247b2fcb95dd5cb36b0ceb75ea7b4906', 28029 ),
	'vo/f2-09-1-e5781bf6bb.mp3' => array( 'a61d9d89ca5a1d576f4f0d4076ff135c56820a15d4cac49ded125c47b67cbd71', 33933 ),
	'vo/f2-09-2-911c941a99.mp3' => array( '6b3f1928aed86e3aa83dc03803fb9b3f18556928070cbd9e27248ac2d00afcc3', 21981 ),
	'vo/f2-09-3-68ea53f31a.mp3' => array( 'de5e2983ea67453e13ce8093b856638cb4f89d50a2158a6595355d526945e0ff', 33789 ),
	'vo/f2-09-4-c1c7d2f99f.mp3' => array( 'c8546d78c818fdd0e17cc797c69d7159512187870c9e00c0f8c658389da46266', 41997 ),
	'vo/f2-09-5-6a8352b5c0.mp3' => array( '5679733f99e50abe40b74f02236e156fd959d8937a744265f64aee9add323e8f', 35949 ),
	'vo/f2-09-6-22794fbd27.mp3' => array( '7f915b0e4a66f4450fd0a7b2e8b30665d2c4d7f1ed56749e3d1975b9aa5b492e', 30909 ),
	'vo/f2-10-1-b814b1654a.mp3' => array( '8a303d59aaa8324e8765b14940eaf75f94740223eedf8d771fbcfa10fb1f9fe1', 44589 ),
	'vo/f2-10-2-9c3ee06e5f.mp3' => array( '19b8fa860ce4825e6370ee83645b46cd6fd22ad600191641b26f25727f2d89c1', 38541 ),
	'vo/f2-10-3-2dbaa4ce3a.mp3' => array( 'b533e3f8a24cd3e8d8573129acdcedda9b10846f7790ea4611a905123d430475', 28461 ),
	'vo/f3-01-1-1107b8367e.mp3' => array( '0a92da258eaedcd91c3c02bc182abaddb72ae6e89859ff372559d4d16824fffe', 49197 ),
	'vo/f3-01-2-c8ac2db8d0.mp3' => array( '58b665d8f89de95be9b7eb9736691c599e6744200c2343ed9073defc40831474', 22557 ),
	'vo/f3-01-3-d4c36ad55f.mp3' => array( '28787d39d0569258f56cabc3c0a69d775fe687ed403064b7f737bbeb623573b2', 14637 ),
	'vo/f3-01-4-29c7f09a80.mp3' => array( '230a1b373b8a905ac16c47a2df93eec321e80f0b3be81c3b44fc09b88be63d5e', 15501 ),
	'vo/f3-02-1-6e79fb386e.mp3' => array( '58789a0e0ee12e242b2b0883139aa149e66a14bd5672cbd4a204786ae9c6cce1', 33069 ),
	'vo/f3-02-2-a74e98a958.mp3' => array( '8abd2ab7811bea1754c8fa4843c4cd660b7d5fd78f29305db068cf6a33ebbf60', 18957 ),
	'vo/f3-03-1-dd0f6353f2.mp3' => array( 'f3df2864ddd46b53768b390e71377b41d32f6fb00f895a289c53dde5f5cebbf7', 35517 ),
	'vo/f3-03-10-524f9be195.mp3' => array( 'fa004f4d386191d20074b2368a960b413150d9743b5560c1caa09727cd0dfb27', 49917 ),
	'vo/f3-03-2-c8e634bfda.mp3' => array( '5ec811bf637ea021e4dadab32d5ed8323b7a1541a1da0440cfbc2065e1f93a6e', 21117 ),
	'vo/f3-03-3-26cc7e0c86.mp3' => array( 'd869985eda5fb31a97f996b512e76ca43cbdebab159f3d409d2ca76e6ce3efa6', 6285 ),
	'vo/f3-03-4-88fe559cf1.mp3' => array( '0e92ca5e0c705c77a1dfe53d87dab9dd1325c6645249928aba6abde9852493e3', 29181 ),
	'vo/f3-03-5-3ccd70bab6.mp3' => array( '608c7b973e46aaef9500036f8fbed54db7e8571dc20eb4d6d9fbbe9929cdeaa7', 21981 ),
	'vo/f3-03-6-afe88797ff.mp3' => array( '5e17f38d75865757c7c14ab6305a4e4dd757f7683bba72b007179f9b6e3c2292', 23421 ),
	'vo/f3-03-7-a006a59c81.mp3' => array( '9c8d06ddef520cb6f8e3edd80d803caaaed93968827359d477e368364a968e64', 23853 ),
	'vo/f3-03-8-1ba22cb949.mp3' => array( '05692d1e0c7d6e3a1272c82b6a21f62f4b28c9cd70bb403027611cf7a62cff0a', 19821 ),
	'vo/f3-03-9-28f1d27795.mp3' => array( 'e6ff5146fb1bf1f7e162126c01548f8738322551a4e598a3d8c3c870e0e7653d', 19677 ),
	'vo/f3-04-1-4165dd272b.mp3' => array( '1d70833a240dcee5787721855730986bcba717102a4c3aae11410b9f5c21524c', 47757 ),
	'vo/f3-04-2-172960959d.mp3' => array( 'c72a5c2db6a93b2b3fec48f376ce20e2c9c17e8137efb917c8beaca5c86650af', 33213 ),
	'vo/f3-05-1-407ce7910e.mp3' => array( 'bd14645c8f659f5c32944352cb415d64665f919044fface4ed60e0e77dab89f7', 50781 ),
	'vo/f3-05-2-35ad457186.mp3' => array( 'a0035a4312b5078f8223f60d786aea80604f74ca74fe32cf046681ec54195019', 26301 ),
);
// rmn-golf v4 allow-list: end
/** The asset sets: route prefix, cache folder, sources (name => base URL), whether the source holds base64 text, and the allow-list. */
const TOUR_ASSET_SETS = array(
	'retail-media' => array( 'prefix' => TOUR_ASSET_PREFIX, 'cache' => 'retail-media/v1', 'b64' => false, 'sources' => array( 'tag' => TOUR_ASSET_TAG_URL, 'mirror' => TOUR_ASSET_MIRROR_URL ), 'assets' => TOUR_ASSETS ),
	'rmn-golf'     => array( 'prefix' => TOUR_ASSET_PREFIX_RMN, 'cache' => 'rmn-golf/v1', 'b64' => true, 'sources' => array( 'repo' => TOUR_ASSET_REPO_URL_RMN, 'mirror' => TOUR_ASSET_MIRROR_URL_RMN ), 'assets' => TOUR_ASSETS_RMN ),
	'rmn-golf-v2'  => array( 'prefix' => TOUR_ASSET_PREFIX_RMN_V2, 'cache' => 'rmn-golf/v2', 'b64' => true, 'sources' => array( 'repo' => TOUR_ASSET_REPO_URL_RMN_V2, 'mirror' => TOUR_ASSET_MIRROR_URL_RMN_V2 ), 'assets' => TOUR_ASSETS_RMN_V2 ),
	'rmn-golf-v3'  => array( 'prefix' => TOUR_ASSET_PREFIX_RMN_V3, 'cache' => 'rmn-golf/v3', 'b64' => true, 'sources' => array( 'repo' => TOUR_ASSET_REPO_URL_RMN_V3, 'mirror' => TOUR_ASSET_MIRROR_URL_RMN_V3 ), 'assets' => TOUR_ASSETS_RMN_V3 ),
	'rmn-golf-v4'  => array( 'prefix' => TOUR_ASSET_PREFIX_RMN_V4, 'cache' => 'rmn-golf/v4', 'b64' => true, 'sources' => array( 'repo' => TOUR_ASSET_REPO_URL_RMN_V4, 'mirror' => TOUR_ASSET_MIRROR_URL_RMN_V4 ), 'assets' => TOUR_ASSETS_RMN_V4 ),
);

/** Same list as FREE_MAIL in tour/tour.html. */
function tour_free_mail( $email ) {
	return (bool) preg_match( '/@(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx|mail|zoho|yandex)\./i', (string) $email );
}

function tour_is_request( $path ) {
	$p = rtrim( (string) $path, '/' );
	foreach ( TOUR_INDUSTRIES as $i ) {
		if ( $i['path'] === $p ) {
			return true;
		}
	}
	return false;
}

/** The asset set (a TOUR_ASSET_SETS key) whose route prefix a request path is under, or null. */
function tour_asset_set( $path ) {
	foreach ( TOUR_ASSET_SETS as $name => $set ) {
		if ( 0 === strpos( (string) $path, $set['prefix'] ) ) {
			return $name;
		}
	}
	return null;
}

/** The allow-list key (dir/file) for a request path under an asset set's prefix, or null. */
function tour_asset_key( $path ) {
	$path = (string) $path;
	$name = tour_asset_set( $path );
	if ( null === $name ) {
		return null;
	}
	$set = TOUR_ASSET_SETS[ $name ];
	$key = substr( $path, strlen( $set['prefix'] ) );
	return ( 1 === preg_match( '#^(img|vo)/[A-Za-z0-9._-]+$#', $key ) && isset( $set['assets'][ $key ] ) ) ? $key : null;
}

function tour_asset_is_request( $path ) {
	return null !== tour_asset_set( $path );
}

function tour_asset_mime( $key ) {
	$ext = strtolower( pathinfo( $key, PATHINFO_EXTENSION ) );
	return array( 'jpg' => 'image/jpeg', 'mp3' => 'audio/mpeg', 'json' => 'application/json' )[ $ext ] ?? 'application/octet-stream';
}

/**
 * The bytes of one allow-listed asset. Returns array( bytes|null, reason, code ). Order: the file cache when its sha256 matches; then the set's sources in order
 * (retail media: the tag, then the jsDelivr mirror of the same tag; golf: the repo's main, then its jsDelivr mirror, each holding base64 text that is decoded first),
 * each accepted only on a 200 whose decoded bytes match the allow-list's sha256 and size; only then stored. The 60 s back-off is set only when every source fails,
 * so a broken upstream is not hammered. code is '' on success, else fetch-failed | sha-mismatch | backoff (the short X-PH-Tour-Reason on the 503; never a URL or error text).
 */
function tour_asset_bytes( $key, $set_name = 'retail-media' ) {
	$set = TOUR_ASSET_SETS[ $set_name ];
	list( $sha, $size ) = $set['assets'][ $key ];
	$up   = wp_upload_dir();
	$file = rtrim( (string) $up['basedir'], '/' ) . '/ph-tour/' . $set['cache'] . '/' . $key;
	$off  = TOUR_ASSET_BACKOFF . md5( 'retail-media' === $set_name ? $key : $set_name . '/' . $key );
	if ( is_file( $file ) ) {
		$have = (string) file_get_contents( $file );
		if ( strlen( $have ) === $size && hash( 'sha256', $have ) === $sha ) {
			return array( $have, '', '' );
		}
	}
	if ( false !== get_transient( $off ) ) {
		return array( null, 'asset ' . $key . ': fetch skipped, backing off after an earlier failure', 'backoff' );
	}
	$whys     = array();
	$mismatch = false;
	foreach ( $set['sources'] as $name => $base ) {
		$res = wp_remote_get( $base . $key . ( $set['b64'] ? '.b64' : '' ), array( 'timeout' => 15 ) );
		if ( is_wp_error( $res ) ) {
			$whys[] = $name . ' fetch failed: ' . $res->get_error_message();
		} elseif ( 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
			$whys[] = $name . ' fetch answered ' . (int) wp_remote_retrieve_response_code( $res );
		} else {
			$body = (string) wp_remote_retrieve_body( $res );
			if ( $set['b64'] ) { // base64 text in the repo: decode strictly; anything that is not base64 fails the sha check below.
				$dec  = base64_decode( (string) preg_replace( '/\s+/', '', $body ), true );
				$body = false === $dec ? $body : $dec;
			}
			if ( hash( 'sha256', $body ) === $sha && strlen( $body ) === $size ) {
				wp_mkdir_p( dirname( $file ) );
				file_put_contents( $file, $body ); // phpcs:ignore WordPress.WP.AlternativeFunctions -- a sha256-checked cache file.
				return array( $body, '', '' );
			}
			$mismatch = true;
			$whys[]   = $name . ' copy does not match its sha256 (received ' . strlen( $body ) . ' bytes, first 16 as hex ' . bin2hex( substr( $body, 0, 16 ) ) . ')';
		}
	}
	set_transient( $off, 1, MINUTE_IN_SECONDS );
	return array( null, 'asset ' . $key . ': ' . implode( '; ', $whys ), $mismatch ? 'sha-mismatch' : 'fetch-failed' );
}

/** Parses a Range header for a body of $size bytes. Returns null (no usable single range: send everything), 'bad' (unsatisfiable: 416) or array( start, end ). */
function tour_asset_range( $header, $size ) {
	if ( ! is_string( $header ) || 1 !== preg_match( '/^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i', $header, $m ) || ( '' === $m[1] && '' === $m[2] ) ) {
		return null; // absent, malformed or multiple ranges.
	}
	if ( '' === $m[1] ) { // suffix: the last N bytes.
		$n = (int) $m[2];
		return $n < 1 ? 'bad' : array( max( 0, $size - $n ), $size - 1 );
	}
	$a = (int) $m[1];
	$b = '' === $m[2] ? $size - 1 : min( (int) $m[2], $size - 1 );
	return ( $a >= $size || $b < $a ) ? 'bad' : array( $a, $b );
}

/** Answers one asset request, then exits. */
function tour_asset_serve( $path, $method, $range ) {
	$key = tour_asset_key( $path );
	if ( null === $key ) {
		status_header( 404 );
		header( 'Content-Type: text/plain; charset=utf-8' );
		header( 'X-Robots-Tag: noindex' );
		header( 'Cache-Control: no-store' );
		echo 'Not found';
		exit;
	}
	list( $bytes, $why, $code ) = tour_asset_bytes( $key, tour_asset_set( $path ) );
	if ( '' !== $why ) {
		error_log( 'ph tour: ' . $why );
	}
	if ( null === $bytes ) {
		status_header( 503 );
		header( 'Content-Type: text/plain; charset=utf-8' );
		header( 'X-Robots-Tag: noindex' );
		header( 'Cache-Control: no-store' );
		header( 'Retry-After: 60' );
		header( 'X-PH-Tour-Reason: ' . $code );
		echo 'Temporarily unavailable';
		exit;
	}
	$size = strlen( $bytes );
	header( 'Content-Type: ' . tour_asset_mime( $key ) );
	header( 'Cache-Control: public, max-age=31536000, immutable' );
	header( 'X-Robots-Tag: noindex' );
	header( 'X-Content-Type-Options: nosniff' );
	header( 'Accept-Ranges: bytes' );
	$r = tour_asset_range( $range, $size );
	if ( 'bad' === $r ) {
		status_header( 416 );
		header( 'Content-Range: bytes */' . $size );
		exit;
	}
	// WordPress adds Pragma: no-cache and Expires: 1984 for logged-in users; Chromium then revalidates despite max-age.
	header_remove( 'Pragma' );
	header_remove( 'Expires' );
	if ( is_array( $r ) ) {
		status_header( 206 );
		header( 'Content-Range: bytes ' . $r[0] . '-' . $r[1] . '/' . $size );
		$bytes = substr( $bytes, $r[0], $r[1] - $r[0] + 1 );
	} else {
		status_header( 200 );
	}
	header( 'Content-Length: ' . strlen( $bytes ) );
	if ( 'HEAD' !== $method ) {
		echo $bytes; // phpcs:ignore WordPress.Security.EscapeOutput -- a sha256-checked binary file.
	}
	exit;
}

function tour_throttled() {
	$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	$key = 'ph_tour_rl_' . md5( $ip );
	$n   = (int) get_transient( $key );
	if ( $n >= 10 ) {
		return true;
	}
	set_transient( $key, $n + 1, HOUR_IN_SECONDS );
	return false;
}

/** Validates and stores a tour lead. Returns array( status, body ). Pure of HTTP, so it is unit-tested. */
function tour_handle( array $b ) {
	if ( ! empty( $b['website'] ) ) { // honeypot: pretend success.
		return array( 200, array( 'ok' => true ) );
	}
	if ( tour_throttled() ) {
		return array( 429, array( 'error' => 'Too many requests. Try again later.' ) );
	}
	$key = isset( $b['industry'] ) && is_string( $b['industry'] ) ? $b['industry'] : '';
	if ( ! isset( TOUR_INDUSTRIES[ $key ] ) ) {
		return array( 400, array( 'error' => 'Unknown industry.', 'field' => 'industry' ) );
	}
	$ind   = TOUR_INDUSTRIES[ $key ];
	$label = $ind['label'];
	$lead = array();
	foreach ( array( 'name', 'company' ) as $k ) {
		$lead[ $k ] = isset( $b[ $k ] ) && is_string( $b[ $k ] ) ? trim( sanitize_text_field( $b[ $k ] ) ) : '';
		if ( '' === $lead[ $k ] || strlen( $lead[ $k ] ) > 120 ) {
			return array( 400, array( 'error' => 'Please complete every field.', 'field' => $k ) );
		}
	}
	$lead['email'] = isset( $b['email'] ) && is_string( $b['email'] ) ? sanitize_email( $b['email'] ) : '';
	if ( ! is_email( $lead['email'] ) ) {
		return array( 400, array( 'error' => 'Please enter a valid email address.', 'field' => 'email' ) );
	}
	if ( tour_free_mail( $lead['email'] ) ) {
		return array( 400, array( 'error' => 'Please use your work email.', 'field' => 'email' ) );
	}
	if ( empty( $b['consent'] ) ) {
		return array( 400, array( 'error' => 'Please tick the box to continue.', 'field' => 'consent' ) );
	}
	$flow = isset( $b['flow'] ) && is_string( $b['flow'] ) ? trim( sanitize_text_field( $b['flow'] ) ) : '';
	$flow = in_array( $flow, TOUR_FLOWS, true ) ? $flow : '';
	$test = lead_is_test( isset( $b['test'] ) ? $b['test'] : false );
	$page = $ind['page'];
	$id   = lead_find_existing( $lead['email'], $test );
	if ( $id ) { // already a lead (for instance from the calculator download): record the tour as activity, not a second lead.
		lead_add_activity( $id, $label, $flow );
	} else {
		$id = wp_insert_post( array( 'post_type' => 'ph_lead', 'post_status' => 'private', 'post_title' => $lead['company'] . ' / ' . $lead['name'] ) );
		if ( $id && ! is_wp_error( $id ) ) {
			foreach ( $lead as $k => $v ) {
				update_post_meta( $id, 'ph_lead_' . $k, $v );
			}
			update_post_meta( $id, 'ph_lead_source', TOUR_SOURCE );
			update_post_meta( $id, 'ph_lead_source_label', $label );
			update_post_meta( $id, 'ph_lead_consent', 1 );
			update_post_meta( $id, 'ph_lead_page', $page );
			if ( $test ) {
				update_post_meta( $id, 'ph_lead_test', '1' );
			}
			lead_add_activity( $id, $label, $flow );
		}
	}
	if ( $id && ! is_wp_error( $id ) ) {
		update_post_meta( $id, 'ph_lead_tour_flow', $flow );
	}
	do_action( 'ph_lead_captured', array_merge( $lead, array( 'source' => TOUR_SOURCE, 'source_label' => $label, 'source_detail' => $flow, 'consent' => true, 'industry' => $key, 'flow' => $flow, 'test' => $test, 'page' => $page, 'post_id' => (int) $id ) ) );
	if ( ! $test ) {
		wp_mail( get_option( 'admin_email' ), 'New ' . $ind['name'] . ' product tour lead: ' . $lead['company'], "Name: {$lead['name']}\nCompany: {$lead['company']}\nEmail: {$lead['email']}\nDemo: $flow\nPage: $page" );
	}
	return array( 200, array( 'ok' => true ) );
}

/**
 * Visitor brand for the walkthrough (12 Nov 2026): POST ph-site/v1/tour-brand {company, email} answers the company's logos from the
 * console's brand lookup (POST /leadIngest/v1/brand, server to server with the lead key, which never reaches the browser), or {found:false}.
 * It answers only for a company and work email this site captured as a real lead (the grant set on ph_lead_captured, or an existing
 * ph_lead with that email and company), so it cannot be used to list which companies the console knows. Throttled per address like
 * tour-lead. Any failure (no key, timeout, error, not found) answers {found:false}, and the tour keeps the initials.
 */
const TOUR_BRAND_URL     = 'https://backlog-tracker-e4ed2.web.app/leadIngest/v1/brand';
const TOUR_BRAND_GRANT   = 'ph_tour_brand_ok_';
const TOUR_BRAND_TIMEOUT = 3;

function tour_brand_grant_key( $email, $company ) {
	return TOUR_BRAND_GRANT . md5( strtolower( trim( (string) $email ) ) . '|' . strtolower( trim( (string) $company ) ) );
}

/** ph_lead_captured (every form on the site): a real, not test, lead may ask for its own company's logos for 30 days. */
function tour_brand_grant( $lead ) {
	if ( ! is_array( $lead ) || ! empty( $lead['test'] ) || empty( $lead['email'] ) || empty( $lead['company'] ) ) {
		return;
	}
	set_transient( tour_brand_grant_key( $lead['email'], $lead['company'] ), 1, 30 * 24 * HOUR_IN_SECONDS );
}

add_action( 'ph_lead_captured', __NAMESPACE__ . '\\tour_brand_grant', 5 );

function tour_brand_allowed( $email, $company ) {
	if ( false !== get_transient( tour_brand_grant_key( $email, $company ) ) ) {
		return true;
	}
	$id = lead_find_existing( $email, false );
	return $id && 0 === strcasecmp( trim( (string) get_post_meta( $id, 'ph_lead_company', true ) ), trim( (string) $company ) );
}

function tour_brand_throttled() {
	$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	$key = 'ph_tour_brand_rl_' . md5( $ip );
	$n   = (int) get_transient( $key );
	if ( $n >= 10 ) {
		return true;
	}
	set_transient( $key, $n + 1, HOUR_IN_SECONDS );
	return false;
}

/** An https image address from the console, else ''. */
function tour_brand_url( $v ) {
	$v = is_string( $v ) ? trim( $v ) : '';
	return ( strlen( $v ) <= 2048 && 1 === preg_match( '#^https://[^\s"\'<>\\\\]+$#i', $v ) ) ? $v : '';
}

/** Returns array( status, body ): only found, logos {light, dark, icon} and darkFromLight. Pure of routing, so it is unit-tested. */
function tour_brand_handle( array $b ) {
	$none = array( 'found' => false );
	if ( tour_brand_throttled() ) {
		return array( 429, array( 'error' => 'Too many requests. Try again later.' ) );
	}
	$company = isset( $b['company'] ) && is_string( $b['company'] ) ? trim( sanitize_text_field( $b['company'] ) ) : '';
	$email   = isset( $b['email'] ) && is_string( $b['email'] ) ? sanitize_email( $b['email'] ) : '';
	if ( '' === $company || strlen( $company ) > 120 || ! is_email( $email ) ) {
		return array( 400, array( 'error' => 'Company and work email are required.' ) );
	}
	if ( ! tour_brand_allowed( $email, $company ) ) {
		return array( 200, $none );
	}
	$key = defined( 'PH_LEAD_INGEST_KEY' ) ? PH_LEAD_INGEST_KEY : (string) get_option( 'ph_lead_ingest_key', '' );
	if ( '' === $key ) {
		return array( 200, $none );
	}
	$res = wp_remote_post( TOUR_BRAND_URL, array(
		'timeout' => TOUR_BRAND_TIMEOUT,
		'headers' => array( 'Content-Type' => 'application/json', 'X-Lead-Key' => $key ),
		'body'    => wp_json_encode( array( 'company' => $company, 'email' => $email ) ),
	) );
	if ( is_wp_error( $res ) || 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
		return array( 200, $none );
	}
	$j = json_decode( (string) wp_remote_retrieve_body( $res ), true );
	if ( ! is_array( $j ) || true !== ( $j['found'] ?? null ) || ! is_array( $j['logos'] ?? null ) ) {
		return array( 200, $none );
	}
	$logos = array();
	foreach ( array( 'light', 'dark', 'icon' ) as $k ) {
		$logos[ $k ] = tour_brand_url( $j['logos'][ $k ] ?? '' );
	}
	if ( '' === implode( '', $logos ) ) {
		return array( 200, $none );
	}
	return array( 200, array( 'found' => true, 'logos' => $logos, 'darkFromLight' => true === ( $j['darkFromLight'] ?? false ) && '' === $logos['dark'] && '' !== $logos['light'] ) );
}

add_action( 'template_redirect', function () {
	$method = isset( $_SERVER['REQUEST_METHOD'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) : 'GET';
	$uri    = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
	$upath  = wp_parse_url( $uri, PHP_URL_PATH );
	if ( ( 'GET' === $method || 'HEAD' === $method ) && tour_asset_is_request( $upath ) ) {
		$range = isset( $_SERVER['HTTP_RANGE'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_RANGE'] ) ) : '';
		tour_asset_serve( $upath, $method, $range );
		return;
	}
	if ( 'GET' !== $method || ! tour_is_request( $upath ) ) {
		return;
	}
	list( $html, $why ) = tour_page();
	if ( '' !== $why ) {
		error_log( 'ph tour: ' . $why );
	}
	if ( null === $html ) {
		status_header( 503 );
		header( 'Content-Type: text/html; charset=utf-8' );
		header( 'X-Robots-Tag: noindex' );
		header( 'Cache-Control: no-store' );
		header( 'Retry-After: 60' );
		echo '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Product tour unavailable</title><p>The product tour is unavailable right now. Please try again shortly.</p>';
		exit;
	}
	status_header( 200 );
	header( 'Content-Type: text/html; charset=utf-8' );
	header( 'X-Robots-Tag: noindex' );
	header( 'X-Frame-Options: SAMEORIGIN' );
	header( "Content-Security-Policy: frame-ancestors 'self'" );
	header( 'Cache-Control: public, max-age=3600' );
	echo $html; // phpcs:ignore WordPress.Security.EscapeOutput -- a fixed page, sha256-pinned when fetched.
	exit;
}, 0 );

add_action( 'rest_api_init', function () {
	register_rest_route( 'ph-site/v1', '/tour-lead', array(
		'methods'             => 'POST',
		'permission_callback' => '__return_true',
		'callback'            => function ( \WP_REST_Request $req ) {
			$b = $req->get_json_params();
			list( $status, $out ) = tour_handle( is_array( $b ) ? $b : array() );
			return new \WP_REST_Response( $out, $status );
		},
	) );
	register_rest_route( 'ph-site/v1', '/tour-brand', array(
		'methods'             => 'POST',
		'permission_callback' => '__return_true',
		'callback'            => function ( \WP_REST_Request $req ) {
			$b = $req->get_json_params();
			list( $status, $out ) = tour_brand_handle( is_array( $b ) ? $b : array() );
			return new \WP_REST_Response( $out, $status );
		},
	) );
} );
