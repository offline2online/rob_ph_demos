<?php
/**
 * Interactive product tour (telco, pharmacy, retail media and fuel & convenience: one shared page, the path picks the industry).
 *
 * - GET /industries/telco/tour/, /industries/pharmacy/tour/, /industries/retail-media/tour/ and /industries/convenience/tour/ (with or without the trailing slash): the same tour page, served same-origin so the industry
 *   page can frame it (`?embed=1`). The HTML is tour-page.php (generated from tour/tour.html by tools/build-tour.mjs) when deployed; otherwise a sha256-pinned copy, see tour_page(). Answered at template_redirect
 *   priority 0 so redirect_canonical never sees it.
 * - GET /industries/retail-media/tour/assets/v1/{img|vo}/<file>: the retail media walkthrough's screenshots and voiceover, same-origin (no third-party request from a visitor). Allow-list TOUR_ASSETS
 *   (generated from tour-assets/retail-media/SHA256SUMS on tag tour-assets-retail-media-v1); served from a file cache in uploads, filled from the tag and checked by sha256; single byte ranges answer 206.
 * - POST ph-site/v1/tour-lead: the tour's gate form. Shaped like telco-model: honeypot, throttle, private ph_lead post, `ph_lead_captured`.
 *   No nonce: the page is edge-cached, so a stale wp_rest nonce would 403 anonymous callers (PH_TOUR.nonce is "").
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const TOUR_SOURCE = 'interactive-product-tour';
const TOUR_FLOWS  = array( 'Campaign creation', 'Localisation & scheduling', 'Personalisation', 'Retailer setup', 'Advertiser creates by talking', 'Shopper journey & outcome', 'Fuel & convenience walkthrough' );
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
/** Industries the tour serves: key = the `industry` the tour sends; path = where the page is served; page = the industry page the lead came from; demos = the three demos. */
const TOUR_INDUSTRIES = array(
	'telco'    => array( 'name' => 'Telco', 'path' => '/industries/telco/tour', 'page' => '/industries/telco/', 'label' => 'Interactive product tour – Telco', 'demos' => TOUR_DEMOS_STD ),
	'pharmacy' => array( 'name' => 'Pharmacy', 'path' => '/industries/pharmacy/tour', 'page' => '/industries/pharmacy/', 'label' => 'Interactive product tour – Pharmacy', 'demos' => TOUR_DEMOS_STD ),
	'retail-media' => array( 'name' => 'Retail Media', 'path' => '/industries/retail-media/tour', 'page' => '/industries/retail-media/', 'label' => 'Interactive product tour – Retail Media', 'demos' => TOUR_DEMOS_RM ),
	'convenience' => array( 'name' => 'Fuel & Convenience', 'path' => '/industries/convenience/tour', 'page' => '/industries/convenience/', 'label' => 'Interactive product tour – Fuel & Convenience', 'demos' => TOUR_DEMOS_STD ),
);

/**
 * Pinned copy of the tour page, used when tour-page.php is not deployed (it is 200 KB, too big for the deploy MCP's inline file
 * writes). The URL follows main; the sha256 is the pin, so the content is guaranteed whatever the URL serves. To update the tour,
 * merge it, then change TOUR_PAGE_SHA256 to the new tour.html's sha256; a changed sha refetches by itself. GitHub's raw CDN can serve the
 * previous main for a few minutes after a merge: until the fetched copy matches, the last good cached copy is served.
 */
const TOUR_PAGE_OPTION  = 'ph_tour_page_html';
const TOUR_PAGE_BACKOFF = 'ph_tour_page_backoff';
const TOUR_PAGE_SHA256  = 'daa2933d78a3ba2b33d46f2ab9cbdac6b2aceffb29aa827ff8a8290636151c1a';
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
 * Embedded copies of assets the host cannot fetch intact (1.9.15): on this host the download of vo/f1-03-3-b1b956b775.mp3 from the tag and from the mirror both came back altered (sha-mismatch).
 * tour_asset_bytes() uses an entry when the file cache holds no valid copy, after checking its size and sha256 against TOUR_ASSETS. Base64 of the file on tag tour-assets-retail-media-v1.
 */
const TOUR_ASSET_SEED = array(
	'vo/f1-03-3-b1b956b775.mp3' => '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',
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

/** The allow-list key (dir/file) for a request path under TOUR_ASSET_PREFIX, or null. */
function tour_asset_key( $path ) {
	$path = (string) $path;
	if ( 0 !== strpos( $path, TOUR_ASSET_PREFIX ) ) {
		return null;
	}
	$key = substr( $path, strlen( TOUR_ASSET_PREFIX ) );
	return ( 1 === preg_match( '#^(img|vo)/[A-Za-z0-9._-]+$#', $key ) && isset( TOUR_ASSETS[ $key ] ) ) ? $key : null;
}

function tour_asset_is_request( $path ) {
	return 0 === strpos( (string) $path, TOUR_ASSET_PREFIX );
}

function tour_asset_mime( $key ) {
	$ext = strtolower( pathinfo( $key, PATHINFO_EXTENSION ) );
	return array( 'jpg' => 'image/jpeg', 'mp3' => 'audio/mpeg', 'json' => 'application/json' )[ $ext ] ?? 'application/octet-stream';
}

/**
 * The bytes of one allow-listed asset. Returns array( bytes|null, reason, code ). Order: the file cache when its sha256 matches; then the embedded copy (TOUR_ASSET_SEED) if there is one; then the tag, then the jsDelivr mirror of the same tag
 * (each accepted only on a 200 whose sha256 matches the allow-list; only then stored). The 60 s back-off is set only when both fail, so a broken upstream is not hammered.
 * code is '' on success, else fetch-failed | sha-mismatch | backoff (the short X-PH-Tour-Reason on the 503; never a URL or error text).
 */
function tour_asset_bytes( $key ) {
	list( $sha, $size ) = TOUR_ASSETS[ $key ];
	$up   = wp_upload_dir();
	$file = rtrim( (string) $up['basedir'], '/' ) . '/ph-tour/retail-media/v1/' . $key;
	if ( is_file( $file ) ) {
		$have = (string) file_get_contents( $file );
		if ( strlen( $have ) === $size && hash( 'sha256', $have ) === $sha ) {
			return array( $have, '', '' );
		}
	}
	if ( isset( TOUR_ASSET_SEED[ $key ] ) ) {
		$seed = base64_decode( TOUR_ASSET_SEED[ $key ], true );
		if ( is_string( $seed ) && strlen( $seed ) === $size && hash( 'sha256', $seed ) === $sha ) {
			wp_mkdir_p( dirname( $file ) );
			file_put_contents( $file, $seed ); // phpcs:ignore WordPress.WP.AlternativeFunctions -- a sha256-checked cache file.
			return array( $seed, '', '' );
		}
		error_log( 'ph tour: asset ' . $key . ': the embedded copy does not match its size or sha256; falling back to the fetch' );
	}
	if ( false !== get_transient( TOUR_ASSET_BACKOFF . md5( $key ) ) ) {
		return array( null, 'asset ' . $key . ': fetch skipped, backing off after an earlier failure', 'backoff' );
	}
	$whys     = array();
	$mismatch = false;
	foreach ( array( 'tag' => TOUR_ASSET_TAG_URL, 'mirror' => TOUR_ASSET_MIRROR_URL ) as $name => $base ) {
		$res = wp_remote_get( $base . $key, array( 'timeout' => 15 ) );
		if ( is_wp_error( $res ) ) {
			$whys[] = $name . ' fetch failed: ' . $res->get_error_message();
		} elseif ( 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
			$whys[] = $name . ' fetch answered ' . (int) wp_remote_retrieve_response_code( $res );
		} else {
			$body = (string) wp_remote_retrieve_body( $res );
			if ( hash( 'sha256', $body ) === $sha ) {
				wp_mkdir_p( dirname( $file ) );
				file_put_contents( $file, $body ); // phpcs:ignore WordPress.WP.AlternativeFunctions -- a sha256-checked cache file.
				return array( $body, '', '' );
			}
			$mismatch = true;
			$whys[]   = $name . ' copy does not match its sha256 (received ' . strlen( $body ) . ' bytes, first 16 as hex ' . bin2hex( substr( $body, 0, 16 ) ) . ')';
		}
	}
	set_transient( TOUR_ASSET_BACKOFF . md5( $key ), 1, MINUTE_IN_SECONDS );
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
	list( $bytes, $why, $code ) = tour_asset_bytes( $key );
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
} );
