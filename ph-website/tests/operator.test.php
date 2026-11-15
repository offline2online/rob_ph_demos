<?php
/**
 * php ph-website/tests/operator.test.php : the Run Your Own RMN page (launched 15 Nov 2026: OPERATOR_LIVE ships true, and one pass forces it
 * hidden through ph_operator_live), /run-your-own-rmn/ (snippet 10063, operator.php), an
 * Elementor page built from ph-website/elementor/run-your-own-rmn.md. POST ph-site/v1/operator-lead validation (400 with the field),
 * optional and normalised LinkedIn, no "I am" (removed 15 Nov 2026: `audience` neither required nor validated, a stray one ignored), the background allow-list, honeypot, 429, personal email accepted, one lead per person in both
 * orders, the ph_lead_captured payload and the console ingest body (leadType, source detail "Run Your Own RMN page – product tour"),
 * the test flag and no admin mail in test. The page: no call path writes a post (operator_init, every hook function and the three
 * shortcodes are run against a page, a plain page, no page and a stale cache; no wp_insert_post / wp_update_post of a page, no
 * post_content anywhere in operator*.php); the page resolves only for a published top-level Elementor page on the slug (cached in
 * ph_operator_page, re-resolved when the cache stops matching); with no page every hook is a no-op. The mount containers
 * (ph-rmn-calculator, ph-rmn-faq, ph-rmn-tour): an Elementor-rendered fixture gets each block exactly once, in place, on the resolved
 * page only; a missing container is skipped; a container plus a widget renders once; the FAQPage JSON-LD appears once. The shortcodes
 * [ph_operator_calculator], [ph_operator_tour], [ph_operator_faq] stay registered (the calculator with its "I am" toggle, defaults in
 * both modes and tooltips, the gate, the FAQ with its FAQPage JSON-LD equal to the questions). Neither share constant is in any output. Keyed by the resolved id: the header menu item "Run Your Own RMN" (only on the page
 * while hidden, everywhere when live); noindex and no sitemap while hidden; the document title, meta description, canonical, Open
 * Graph, Twitter card and head JSON-LD; llms.txt, the markdown twin, the agent endpoint and robots.txt naming the page only when live
 * and the page exists. The build brief carries every line the twin publishes, the anchors and the mount containers in order. The retired
 * offer name is checked for with the pattern fr[a]nch, and the page's previous name with a bracketed pattern, so that this file itself
 * never contains them.
 */
namespace {
error_reporting( E_ALL );
define( 'ABSPATH', '/' );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'OBJECT', 'OBJECT' );
define( 'PH_OPERATOR_TEST', 1 );
$fails = 0;
$count = 0;
function ok( $c, $m ) { global $fails, $count; $count++; if ( ! $c ) { $fails++; fwrite( STDERR, "FAIL: $m\n" ); } }
$dir = dirname( __DIR__ ) . '/snippets/ph-industry-enhancements';

$GLOBALS['opts'] = array( 'admin_email' => 'a@x.test' ); $GLOBALS['tr'] = array(); $GLOBALS['posts'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['fired'] = array(); $GLOBALS['mails'] = array(); $GLOBALS['filters'] = array();
function add_action( $n, $cb ) {} function add_filter() {} function register_setting() {} function add_settings_field() {} function current_user_can() { return false; }
function apply_filters( $n, $v ) { return array_key_exists( $n, $GLOBALS['filters'] ) ? $GLOBALS['filters'][ $n ] : $v; }
function wp_unslash( $v ) { return $v; } function sanitize_text_field( $v ) { return trim( strip_tags( (string) $v ) ); } function sanitize_textarea_field( $v ) { return trim( strip_tags( (string) $v ) ); }
function sanitize_email( $v ) { return trim( (string) $v ); } function is_email( $v ) { return (bool) filter_var( $v, FILTER_VALIDATE_EMAIL ); }
function get_transient( $k ) { return $GLOBALS['tr'][ $k ] ?? false; } function set_transient( $k, $v ) { $GLOBALS['tr'][ $k ] = $v; }
function wp_insert_post( $a ) { if ( 'ph_lead' !== ( $a['post_type'] ?? '' ) ) { $GLOBALS['page_writes'][] = array( 'insert', $a ); } $GLOBALS['posts'][] = $a; $id = count( $GLOBALS['posts'] ); if ( ! empty( $a['meta_input'] ) ) { foreach ( $a['meta_input'] as $k => $v ) { $GLOBALS['meta'][ $id ][ $k ] = $v; } } return $id; }
function wp_update_post( $a ) { $GLOBALS['page_writes'][] = array( 'update', $a ); $GLOBALS['updated'][] = $a; if ( isset( $GLOBALS['pages'][ $a['ID'] ] ) ) { $pg = $GLOBALS['pages'][ $a['ID'] ]; if ( isset( $a['post_name'] ) && $a['post_name'] !== $pg->post_name && empty( $GLOBALS['update_fails'] ) ) { $GLOBALS['meta'][ $a['ID'] ]['_wp_old_slug'] = $pg->post_name; } /* as wp_check_for_changed_slugs does */ foreach ( array( 'post_name', 'post_title', 'post_status', 'post_content', 'post_parent' ) as $k ) { if ( isset( $a[ $k ] ) ) { $pg->$k = $a[ $k ]; } } } return $GLOBALS['update_fails'] ?? false ? 0 : $a['ID']; }
function is_wp_error() { return false; }
function update_post_meta( $id, $k, $v ) { $GLOBALS['meta'][ $id ][ $k ] = $v; }
function delete_post_meta( $id, $k ) { unset( $GLOBALS['meta'][ $id ][ $k ] ); }
function get_post_meta( $id, $k, $single = false ) { return $GLOBALS['meta'][ $id ][ $k ] ?? ''; }
class WP_Query { public $posts = array(); function __construct( $a ) { $email = $a['meta_query'][0]['value']; $test = isset( $a['meta_query'][1]['value'] );
	foreach ( $GLOBALS['meta'] as $id => $m ) { if ( ( $m['ph_lead_email'] ?? '' ) === $email && ( '1' === ( $m['ph_lead_test'] ?? '' ) ) === $test ) { $this->posts[] = $id; break; } } } }
function do_action( $n, $p = null ) { $GLOBALS['fired'][] = array( $n, $p ); }
function wp_mail( $to, $s, $b ) { $GLOBALS['mails'][] = array( $to, $s, $b ); }
function get_option( $k, $d = false ) { return array_key_exists( $k, $GLOBALS['opts'] ) ? $GLOBALS['opts'][ $k ] : $d; }
function add_option( $k, $v ) { if ( array_key_exists( $k, $GLOBALS['opts'] ) ) { return false; } $GLOBALS['opts'][ $k ] = $v; return true; }
function update_option( $k, $v ) { $GLOBALS['opts'][ $k ] = $v; return true; }
function delete_option( $k ) { unset( $GLOBALS['opts'][ $k ] ); return true; }
function wp_json_encode( $v ) { return json_encode( $v ); }
function esc_attr( $v ) { return htmlspecialchars( (string) $v, ENT_QUOTES ); } function esc_html( $v ) { return htmlspecialchars( (string) $v, ENT_QUOTES ); }
function home_url( $p = '' ) { return 'https://personalisationhub.com' . $p; }
function wp_strip_all_tags( $v ) { return strip_tags( (string) $v ); }
$GLOBALS['pages'] = array();
function get_post( $id ) { return $GLOBALS['pages'][ $id ] ?? null; }
function get_page_by_path( $p ) { $GLOBALS['by_path']++; foreach ( $GLOBALS['pages'] as $pg ) { if ( $pg->post_name === $p && 'trash' !== $pg->post_status ) { return $pg; } } return null; }
$GLOBALS['by_path'] = 0; $GLOBALS['page_writes'] = array();
function wp_delete_post() { $GLOBALS['page_writes'][] = array( 'delete' ); } function wp_trash_post() { $GLOBALS['page_writes'][] = array( 'trash' ); }
function wp_enqueue_style( $h ) { $GLOBALS['enq'][] = $h; } function wp_enqueue_script( $h ) { $GLOBALS['enq'][] = $h; } function wp_add_inline_script( $h, $js ) { $GLOBALS['enq'][] = $js; }
function angie_cs_get_snippet_asset_url( $f, $n ) { return 'https://x.test/' . $n; }
class WP_Post { public $ID; public $post_name; public $post_title = ''; public $post_content = ''; public $post_parent = 0; public $post_type = 'page'; public $post_status = 'publish'; }
$GLOBALS['is_page'] = false; $GLOBALS['qo'] = null;
function is_page() { return $GLOBALS['is_page']; } function get_queried_object() { return $GLOBALS['qo']; }

function is_admin() { return false; } function wp_doing_ajax() { return false; } function wp_doing_cron() { return false; }
require $dir . '/leads.php';
require $dir . '/operator.php';
require $dir . '/redirects.php';
require $dir . '/ai-surface.php';
require $dir . '/tour.php'; // TOUR_INDUSTRIES: the golf tour joins llms.txt and the twins only when the page is live (ai_tours())
}

namespace AngieSnippets\PhIndustryEnhancements_10063 {
const PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063 = 'test'; // main.php's, for operator_enqueue()
$n_ip = 0;
$call = function ( array $b, $ip = null ) use ( &$n_ip ) { $_SERVER['REMOTE_ADDR'] = $ip ?? '10.0.0.' . ( ++$n_ip ); return operator_handle( $b ); };
$good = array( 'name' => 'Ada Lovelace', 'email' => 'ada@gmail.com', 'linkedin' => 'linkedin.com/in/ada', 'region' => 'Manchester and the North West', 'background' => 'Retail media', 'consent' => true, 'page' => '/run-your-own-rmn/', 'test' => false, 'website' => '' );
$reset = function () { $GLOBALS['posts'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['fired'] = array(); $GLOBALS['mails'] = array(); };

/* Validation: 400 with the field */
foreach ( array(
	array( 'name', '' ), array( 'name', str_repeat( 'a', 121 ) ), array( 'email', 'nope' ), array( 'email', str_repeat( 'a', 112 ) . '@ex.test' ),
	array( 'linkedin', 'https://example.com/in/ada' ), array( 'linkedin', 'ftp://linkedin.com/in/ada' ), array( 'linkedin', 'https://linkedin.com.evil.test/in/a' ), array( 'linkedin', 'https://' . str_repeat( 'a', 290 ) . '.linkedin.com/x' ),
	array( 'region', '' ), array( 'region', str_repeat( 'r', 121 ) ), array( 'background', '' ), array( 'background', 'Astronaut' ), array( 'consent', false ),
) as $c ) {
	list( $st, $out ) = $call( array_merge( $good, array( $c[0] => $c[1] ) ) );
	ok( 400 === $st && $c[0] === ( $out['field'] ?? '' ) && '' !== ( $out['error'] ?? '' ), "400 with field {$c[0]} for " . substr( var_export( $c[1], true ), 0, 40 ) );
}
ok( ! $GLOBALS['posts'] && ! $GLOBALS['fired'], 'invalid submissions store and fire nothing' );

/* LinkedIn optional and normalised */
foreach ( array( '' => '', 'linkedin.com/in/ada' => 'https://linkedin.com/in/ada', 'www.linkedin.com/in/ada' => 'https://www.linkedin.com/in/ada', 'http://uk.linkedin.com/in/ada' => 'https://uk.linkedin.com/in/ada', 'https://www.linkedin.com/in/ada?x=1' => 'https://www.linkedin.com/in/ada?x=1' ) as $in => $want ) {
	list( $okl, $v ) = operator_linkedin( $in );
	ok( $okl && $want === $v, "linkedin '$in' -> '$want' (got '$v')" );
}
list( $st ) = $call( array_merge( $good, array( 'linkedin' => '' ) ) ); ok( 200 === $st, 'LinkedIn left blank is accepted' );
$reset();

/* Background allow-list */
foreach ( OPERATOR_BACKGROUNDS as $bg ) {
	list( $st ) = $call( array_merge( $good, array( 'background' => $bg, 'email' => 'bg' . md5( $bg ) . '@x.test' ) ) );
	ok( 200 === $st, "background accepted: $bg" );
}
ok( array( 'Agency media or account management', 'Ad-tech sales or partnerships', 'Retail media', 'Creative agency', 'Retail business owner or manager', 'Marketing', 'Something else' ) === OPERATOR_BACKGROUNDS, 'the seven backgrounds, in the design\'s order (adds "Creative agency" and "Retail business owner or manager")' );
/* No "I am" (15 Nov 2026): a body without `audience` is accepted; a stray one, any value, is ignored, never an error or stored */
ok( ! defined( __NAMESPACE__ . '\\OPERATOR_AUDIENCES' ) && ! defined( 'AngieSnippets\\PhIndustryEnhancements_10063\\OPERATOR_AUDIENCES' ), 'no OPERATOR_AUDIENCES list any more' );
ok( ! array_key_exists( 'audience', $good ), 'the good body carries no audience' );
foreach ( array( '', 'A large retailer', 'operator', 'An individual operator' ) as $i => $au ) {
	$reset();
	list( $st, $out ) = $call( array_merge( $good, array( 'audience' => $au, 'email' => "au$i@x.test" ) ) );
	ok( 200 === $st && ! empty( $out['ok'] ) && ! isset( $GLOBALS['meta'][1]['ph_lead_audience'] ) && ! array_key_exists( 'audience', $GLOBALS['fired'][0][1] ) && false === strpos( $GLOBALS['mails'][0][2], 'I am' ), 'a stray audience ' . var_export( $au, true ) . ' is ignored: 200, not stored, not in the payload or the email' );
}
$reset();

/* Honeypot, throttle, personal email */
list( $st, $out ) = $call( array_merge( $good, array( 'website' => 'spam' ) ) );
ok( 200 === $st && ! empty( $out['ok'] ) && ! $GLOBALS['posts'] && ! $GLOBALS['fired'] && ! $GLOBALS['mails'], 'honeypot pretends success and stores nothing' );
$GLOBALS['tr'] = array();
for ( $i = 0; $i < 10; $i++ ) { $call( array_merge( $good, array( 'email' => "t$i@x.test" ) ), '9.9.9.9' ); }
list( $st ) = $call( $good, '9.9.9.9' ); ok( 429 === $st, 'the 11th request in an hour from one address answers 429 (lead_throttled)' );
$GLOBALS['tr'] = array(); $reset();
list( $st ) = $call( $good ); ok( 200 === $st, 'personal email domain (gmail) accepted: applicants are individuals' );

/* Stored lead and the ph_lead_captured payload */
$m = $GLOBALS['meta'][1];
ok( 'ph_lead' === $GLOBALS['posts'][0]['post_type'] && 'private' === $GLOBALS['posts'][0]['post_status'], 'a private ph_lead' );
ok( 'Ada Lovelace' === $m['ph_lead_name'] && 'ada@gmail.com' === $m['ph_lead_email'] && 'https://linkedin.com/in/ada' === $m['ph_lead_linkedin'] && 'Manchester and the North West' === $m['ph_lead_region'] && 'Retail media' === $m['ph_lead_background'] && ! isset( $m['ph_lead_audience'] ), 'meta: name, email, linkedin, region and background; no audience' );
ok( 'operator' === $m['ph_lead_source'] && 'Network operator inquiry' === $m['ph_lead_source_label'] && 1 === $m['ph_lead_consent'] && '/run-your-own-rmn/' === $m['ph_lead_page'] && ! isset( $m['ph_lead_test'] ), 'meta: source key operator, label "Network operator inquiry", consent, page /run-your-own-rmn/, not test' );
ok( 'Network operator inquiry' === $m['ph_lead_activity'][0]['label'] && 'Run Your Own RMN page – product tour' === $m['ph_lead_activity'][0]['detail'], 'activity row "Network operator inquiry", detail "Run Your Own RMN page – product tour"' );
ok( 'Ada Lovelace / Network operator inquiry' === $GLOBALS['posts'][0]['post_title'], 'lead title names the new label' );
$p = $GLOBALS['fired'][0];
ok( 'ph_lead_captured' === $p[0], 'fires ph_lead_captured' );
$p = $p[1];
foreach ( array( 'company' => 'Ada Lovelace', 'company_industry' => 'Network operator inquiry', 'industry' => 'operator', 'contact_name' => 'Ada Lovelace', 'email' => 'ada@gmail.com', 'linkedin' => 'https://linkedin.com/in/ada', 'countries' => 'Manchester and the North West', 'job_title' => 'Retail media', 'source_label' => 'Network operator inquiry', 'source_detail' => 'Run Your Own RMN page – product tour', 'lead_type' => 'operator', 'source' => 'operator', 'page' => '/run-your-own-rmn/', 'test' => false ) as $k => $v ) {
	ok( array_key_exists( $k, $p ) && $v === $p[ $k ], "payload $k = " . var_export( $v, true ) );
}
ok( 1 === count( $GLOBALS['mails'] ) && 'New network operator inquiry: Ada Lovelace' === $GLOBALS['mails'][0][1] && 'a@x.test' === $GLOBALS['mails'][0][0], 'admin email "New network operator inquiry: <name>"' );
ok( ! array_key_exists( 'audience', $p ), 'payload: no audience (the console stores a blank)' );
ok( false === strpos( $GLOBALS['mails'][0][2], 'I am' ) && false !== strpos( $GLOBALS['mails'][0][2], "Where they plan to operate: Manchester and the North West\nBackground: Retail media\n" ), 'admin email: no "I am:" line, Background straight after Where they plan to operate' );
ok( false !== strpos( $GLOBALS['mails'][0][2], 'Page: /run-your-own-rmn/' ) && ! preg_match( '/fr[a]nch/i', $GLOBALS['mails'][0][1] . $GLOBALS['mails'][0][2] ), 'admin email names the new page and never the retired offer name' );

/* Ingest body */
$body = lead_ingest_body( $p );
foreach ( array( 'company' => 'Ada Lovelace', 'industry' => 'Network operator inquiry', 'countries' => 'Manchester and the North West', 'contactName' => 'Ada Lovelace', 'jobTitle' => 'Retail media', 'email' => 'ada@gmail.com', 'linkedin' => 'https://linkedin.com/in/ada', 'page' => '/run-your-own-rmn/', 'pageIndustry' => 'operator', 'sourceLabel' => 'Network operator inquiry', 'sourceDetail' => 'Run Your Own RMN page – product tour', 'leadType' => 'operator', 'region' => 'Manchester and the North West', 'background' => 'Retail media' ) as $k => $v ) {
	ok( isset( $body[ $k ] ) && $v === $body[ $k ], "ingest body $k" );
}
ok( ! isset( $body['audience'] ), 'ingest body: no audience, so the console stores a blank one' );
ok( ! isset( $body['test'] ), 'ingest body: no test flag for a real lead' );
$other = lead_ingest_body( array( 'company' => 'Nimbus', 'name' => 'Ada', 'email' => 'a@n.test', 'industry' => 'telco', 'source_label' => 'Interactive product tour – Telco' ) );
ok( ! isset( $other['leadType'] ) && ! isset( $other['region'] ) && ! isset( $other['background'] ) && ! isset( $other['audience'] ), 'other pages\' bodies are unchanged (no leadType, region, background, audience)' );

/* One lead per person, both orders */
$reset();
$GLOBALS['meta'][1] = array( 'ph_lead_email' => 'grace@orbit.example', 'ph_lead_company' => 'Orbit', 'ph_lead_source' => 'interactive-product-tour', 'ph_lead_activity' => array( array( 'label' => 'Interactive product tour – Retail Media', 'detail' => '', 'at' => 'x' ) ) );
$GLOBALS['posts'][] = array( 'post_type' => 'ph_lead' );
list( $st ) = $call( array_merge( $good, array( 'email' => 'grace@orbit.example', 'name' => 'Grace Hopper' ) ) );
ok( 200 === $st && 1 === count( $GLOBALS['posts'] ), 'industry tour then operator inquiry: no second lead' );
$acts = $GLOBALS['meta'][1]['ph_lead_activity'];
ok( 2 === count( $acts ) && 'Network operator inquiry' === $acts[1]['label'], 'industry tour then operator inquiry: an activity row "Network operator inquiry" is added' );
ok( 'interactive-product-tour' === $GLOBALS['meta'][1]['ph_lead_source'] && 'Orbit' === $GLOBALS['meta'][1]['ph_lead_company'] && 'Retail media' === $GLOBALS['meta'][1]['ph_lead_background'] && ! isset( $GLOBALS['meta'][1]['ph_lead_audience'] ), 'the existing lead keeps its source and company and gains the network operator fields' );
ok( 1 === (int) $GLOBALS['fired'][0][1]['post_id'], 'payload names the existing lead' );
// operator inquiry then industry tour (tour.php adds activity to the same lead)
$reset();
list( $st ) = $call( array_merge( $good, array( 'email' => 'lin@x.test' ) ) );
ok( 1 === lead_find_existing( 'lin@x.test', false ), 'operator inquiry then industry: lead_find_existing finds the operator lead' );
lead_add_activity( 1, 'Interactive product tour – Telco', 'Personalisation' );
ok( 2 === count( $GLOBALS['meta'][1]['ph_lead_activity'] ) && 1 === count( $GLOBALS['posts'] ), 'operator inquiry then industry: one lead, two activity rows' );

/* Test flag */
$reset();
list( $st ) = $call( array_merge( $good, array( 'test' => true, 'email' => 'test@x.test' ) ) );
ok( 200 === $st && '1' === $GLOBALS['meta'][1]['ph_lead_test'] && true === $GLOBALS['fired'][0][1]['test'] && ! $GLOBALS['mails'], 'test: flagged, test in the payload, no admin email' );
ok( true === lead_ingest_body( $GLOBALS['fired'][0][1] )['test'], 'test: ingest body carries test' );
list( $st ) = $call( array_merge( $good, array( 'test' => '1', 'email' => 'test@x.test' ) ) );
ok( 1 === count( $GLOBALS['posts'] ), 'test leads dedupe among test leads' );
list( $st ) = $call( array_merge( $good, array( 'email' => 'test@x.test' ) ) );
ok( 2 === count( $GLOBALS['posts'] ), 'a real lead is kept apart from a test lead with the same email' );

/* The page: resolved, never made. A published top-level ELEMENTOR page on the slug (_elementor_edit_mode = builder). */
$mkpage = function ( $id, $mode = 'builder', $status = 'publish', $parent = 0, $slug = 'run-your-own-rmn' ) {
	$p = new \WP_Post(); $p->ID = $id; $p->post_name = $slug; $p->post_status = $status; $p->post_parent = $parent; $p->post_title = 'Run Your Own RMN';
	$GLOBALS['pages'][ $id ] = $p; $GLOBALS['meta'][ $id ]['_elementor_edit_mode'] = $mode;
	return $p;
};
$fresh = function () { $GLOBALS['pages'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['opts'] = array( 'admin_email' => 'a@x.test' ); $GLOBALS['posts'] = array(); $GLOBALS['updated'] = array(); $GLOBALS['page_writes'] = array(); $GLOBALS['is_page'] = false; $GLOBALS['qo'] = null; $GLOBALS['filters'] = array(); };
$fresh();
ok( 0 === operator_page_id() && ! isset( $GLOBALS['opts']['ph_operator_page'] ), 'no page: id 0, nothing cached' );
$plain = $mkpage( 10776, '' ); // the plain WordPress page the hidden build used to be (no Elementor data)
ok( 0 === operator_page_id(), 'a plain WordPress page on the slug is not the page (not an Elementor document)' );
$mkpage( 10776, 'builder', 'draft' );
ok( 0 === operator_page_id(), 'a draft Elementor page on the slug is not the page' );
$fresh(); $mkpage( 55, 'builder', 'publish', 9 );
ok( 0 === operator_page_id(), 'a child page on the slug is not the page' );
$fresh(); $mkpage( 56, 'builder', 'publish', 0, 'something-else' );
ok( 0 === operator_page_id(), 'an Elementor page on another slug is not the page' );
$fresh(); $el = $mkpage( 10900 );
ok( 10900 === operator_page_id() && 10900 === $GLOBALS['opts']['ph_operator_page'], 'a published top-level Elementor page on the slug resolves, and its id is cached in ph_operator_page' );
$GLOBALS['by_path'] = 0;
ok( 10900 === operator_page_id() && 0 === $GLOBALS['by_path'], 'a matching cached id answers without looking the slug up again' );
// The cache stops matching: the old page 10776 trashed (WordPress renames a trashed page's slug) and the Elementor page published.
$fresh(); $old = $mkpage( 10776, '' ); $GLOBALS['opts']['ph_operator_page'] = 10776; $old->post_status = 'trash'; $old->post_name = 'run-your-own-rmn__trashed'; $mkpage( 10900 );
ok( 10900 === operator_page_id() && 10900 === $GLOBALS['opts']['ph_operator_page'], 'a stale cached id (page 10776 in the Trash) re-resolves to the Elementor page' );
$GLOBALS['meta'][10900]['_elementor_edit_mode'] = '';
ok( 0 === operator_page_id() && ! isset( $GLOBALS['opts']['ph_operator_page'] ), 'a page that stops being an Elementor document stops being the page; the cache is cleared' );
ok( ! $GLOBALS['page_writes'] && ! $GLOBALS['posts'] && ! $GLOBALS['updated'], 'resolving never writes a post' );

/* No call path writes a post: init, every hook function and the three shortcodes, with a page, a plain page, no page and a stale cache */
$hooks = function () {
	operator_init(); operator_sync_state(); operator_is_page(); operator_robots( array( 'index' => true ) ); operator_document_title( 'T' ); operator_sitemap_args( array() );
	operator_menu_objects( array(), true, true ); operator_head_html( operator_og_image(), true ); operator_llms_filter( 'x', true ); operator_agent_page( true ); operator_robots_allow( array(), true ); operator_seopress_off( 'x' );
	operator_calculator_html(); operator_tour_html(); operator_faq_html(); operator_request_html(); operator_twin();
	operator_mount_blocks( '<div class="elementor"><div class="e-con" id="ph-rmn-calculator"></div><div class="e-con" id="ph-rmn-faq"></div><div class="e-con" id="ph-rmn-tour"></div><div class="e-con" id="ph-rmn-request"></div></div>' );
};
foreach ( array( 'elementor page' => function () use ( $mkpage ) { $mkpage( 10900 ); }, 'plain page' => function () use ( $mkpage ) { $mkpage( 10776, '' ); }, 'no page' => function () {}, 'stale cache' => function () use ( $mkpage ) { $GLOBALS['opts']['ph_operator_page'] = 10776; } ) as $case => $setup ) {
	foreach ( array( false, true ) as $onpage ) {
		$fresh(); $setup(); $GLOBALS['is_page'] = $onpage; $GLOBALS['qo'] = $GLOBALS['pages'][10900] ?? $GLOBALS['pages'][10776] ?? null;
		$hooks();
		ok( ! $GLOBALS['page_writes'] && ! $GLOBALS['posts'] && ! $GLOBALS['updated'], "no post written ($case, " . ( $onpage ? 'on the page' : 'elsewhere' ) . '): ' . json_encode( $GLOBALS['page_writes'] ) );
	}
}
$fresh();
$srcs = '';
foreach ( glob( $dir . '/operator*.php' ) as $f ) { $srcs .= (string) file_get_contents( $f ); }
foreach ( array( 'wp_insert_post', 'wp_update_post', 'post_content', 'wp_delete_post', 'wp_trash_post', 'operator_ensure_page', 'operator_create_page', 'operator_move_page', '_wp_page_template', '10776' ) as $w ) {
	ok( false === strpos( $srcs, $w ), "operator*.php never contains $w" );
}
ok( ! preg_match( '/fr[a]nch/i', $srcs ) && ! preg_match( '/own[ ]boss/i', $srcs ), 'operator*.php: neither the retired offer name nor the previous page name' );

/* With no page, every hook is a no-op: even live, on a page with the slug that is not an Elementor document */
foreach ( array( false, true ) as $lv ) {
	$fresh(); $plain = $mkpage( 10776, '' ); $GLOBALS['is_page'] = true; $GLOBALS['qo'] = $plain; $GLOBALS['filters']['ph_operator_live'] = $lv;
	$l = $lv ? 'live' : 'hidden';
	ok( false === operator_is_page(), "no page ($l): operator_is_page() is false on the plain page" );
	operator_sync_state();
	ok( ! isset( $GLOBALS['meta'][10776]['_seopress_robots_index'] ) && ! isset( $GLOBALS['opts']['ph_operator_state'] ), "no page ($l): no noindex meta, no state" );
	ok( array( 'index' => true ) === operator_robots( array( 'index' => true ) ), "no page ($l): robots unchanged" );
	ok( 'T' === operator_document_title( 'T' ) && 'x' === operator_seopress_off( 'x' ), "no page ($l): title and SEOPress untouched" );
	ok( array( 'post_type' => 'page' ) === operator_sitemap_args( array( 'post_type' => 'page' ) ), "no page ($l): sitemaps unchanged" );
	$mm = array( (object) array( 'ID' => 3, 'title' => 'Industry', 'url' => '/industries/', 'menu_item_parent' => '0', 'classes' => array(), 'current' => false ), (object) array( 'ID' => 5, 'title' => 'Support', 'url' => '/support-centre/', 'menu_item_parent' => '0', 'classes' => array(), 'current' => false ) );
	ok( 2 === count( operator_menu_objects( $mm, true, $lv ) ) && 2 === count( operator_menu_objects( $mm, false, true ) ), "no page ($l): no menu item" );
	ok( null === operator_agent_page( true ), "no page ($l): nothing for the agent endpoint" );
	$GLOBALS['enq'] = array(); operator_enqueue();
	ok( ! $GLOBALS['enq'], "no page ($l): operator.css and operator.js are not enqueued" );
}
$fresh();
$hsrc = (string) file_get_contents( $dir . '/operator.php' );
ok( false !== strpos( $hsrc, "operator_llms_filter( \$text, operator_is_live() && operator_page_id() > 0 )" ) && false !== strpos( $hsrc, "operator_robots_allow( \$paths, operator_is_live() && operator_page_id() > 0 )" ), 'no page: llms.txt and robots.txt are only changed when live AND the page exists' );
ok( false !== strpos( $hsrc, "if ( ! is_array( \$items ) || ( ! \$on_page && ! \$live ) || ! operator_page_id() ) {" ), 'no page: the menu filter returns the menu unchanged' );

/* The shortcodes stay registered: the same three blocks, each enqueuing the page's assets (on the page only) */
ok( array( 'calculator' => 'ph_operator_calculator', 'tour' => 'ph_operator_tour', 'faq' => 'ph_operator_faq', 'request' => 'ph_operator_request' ) === OPERATOR_SHORTCODES, 'shortcodes [ph_operator_calculator], [ph_operator_tour], [ph_operator_faq], [ph_operator_request]' );
foreach ( array( 'calculator' => 'operator_calculator_html', 'tour' => 'operator_tour_html', 'faq' => 'operator_faq_html', 'request' => 'operator_request_html' ) as $k => $fn ) {
	ok( false !== strpos( $hsrc, "add_shortcode( OPERATOR_SHORTCODES['$k'], function () {\n\t\toperator_enqueue();\n\t\treturn $fn();" ), "[ph_operator_$k] enqueues the assets and returns $fn()" );
}
ok( false === strpos( $hsrc, "add_shortcode( 'ph_operator'," ) && false === strpos( $hsrc, 'OPERATOR_SHORTCODE,' ), 'the whole-page [ph_operator] shortcode is gone' );
$fresh(); $el = $mkpage( 10900 ); $GLOBALS['is_page'] = true; $GLOBALS['qo'] = $el; $GLOBALS['enq'] = array();
operator_enqueue(); operator_enqueue();
ok( array( 'ph-operator-10063', 'ph-operator-10063' ) === array_slice( $GLOBALS['enq'], 0, 2 ) && 3 === count( $GLOBALS['enq'] ) && false !== strpos( $GLOBALS['enq'][2], 'window.PH_OPERATOR = {"endpoint":"\/wp-json\/ph-site\/v1\/operator-lead","tour":"\/run-your-own-rmn\/tour\/"}' ), 'on the page: operator.css, operator.js and window.PH_OPERATOR, enqueued once however many blocks call it' );
$fresh();

/* The mount containers: Elementor's rendered page with three empty containers gets each block once, in place, on the resolved page only */
$econ = function ( $id, $inner = '' ) { return '<div class="elementor-element elementor-element-' . substr( md5( $id ), 0, 7 ) . ' e-con-full e-flex e-con e-parent" data-id="' . substr( md5( $id ), 0, 7 ) . '" data-element_type="e-flexbox"' . ( '' !== $id ? ' id="' . $id . '"' : '' ) . ' data-settings="{&quot;k&quot;:&quot;a &gt; b&quot;}">' . $inner . '</div>'; };
$fixture = function ( array $ids ) use ( $econ ) { $h = '<div data-elementor-type="wp-page" data-elementor-id="10785" class="elementor elementor-10785">'; foreach ( $ids as $id ) { $h .= $econ( $id, in_array( $id, OPERATOR_MOUNTS, true ) ? '' : '<h2>' . $id . '</h2>' ); } return $h . '</div>'; };
$all_ids = array( 'top', 'why', 'who', 'how', 'venues', 'standards', 'ph-rmn-calculator', 'independents', 'ph-rmn-faq', 'ph-rmn-tour', 'ph-rmn-request' );
ok( array( 'calculator' => 'ph-rmn-calculator', 'faq' => 'ph-rmn-faq', 'tour' => 'ph-rmn-tour', 'request' => 'ph-rmn-request' ) === OPERATOR_MOUNTS, 'mount containers: CSS IDs ph-rmn-calculator, ph-rmn-faq, ph-rmn-tour, ph-rmn-request (the request form, after the tour)' );
$fx = $fixture( $all_ids );
$fresh(); $el = $mkpage( 10785 ); $GLOBALS['is_page'] = true; $GLOBALS['qo'] = $el; // \$GLOBALS['enq'] still holds the three entries from the check above
$mounted = operator_mount( $fx );
$blocks  = array( 'calculator' => operator_calculator_html(), 'faq' => operator_faq_html(), 'tour' => operator_tour_html(), 'request' => operator_request_html() );
foreach ( OPERATOR_MOUNTS as $k => $cid ) {
	ok( 1 === substr_count( $mounted, 'data-phf="' . $k . '"' ) && 1 === substr_count( $mounted, $blocks[ $k ] ), "mount: the $k block is in the page exactly once" );
	$open = substr( $econ( $cid ), 0, -6 );
	ok( false !== strpos( $mounted, $open . $blocks[ $k ] . '</div>' ), "mount: the $k block sits inside #$cid, straight after its opening tag" );
}
$md = new \DOMDocument(); @$md->loadHTML( '<?xml encoding="utf-8"?>' . $mounted ); $mx = new \DOMXPath( $md );
foreach ( array( 'ph-rmn-calculator' => 'calculator', 'ph-rmn-faq' => 'faq', 'ph-rmn-tour' => 'tour', 'ph-rmn-request' => 'request-info' ) as $cid => $anchor ) {
	ok( 1 === $mx->query( '//div[@id="' . $cid . '"]/div[contains(@class,"phf-block")]/section[@id="' . $anchor . '"]' )->length && 1 === $mx->query( '//*[@id="' . $anchor . '"]' )->length, "mount: #$anchor is inside the block inside #$cid, once in the document" );
}
ok( 1 === $mx->query( '//script[@type="application/ld+json"]' )->length && 1 === substr_count( $mounted, '"@type":"FAQPage"' ) && 1 === $mx->query( '//div[@id="ph-rmn-faq"]//script[@type="application/ld+json"]' )->length, 'mount: the FAQPage JSON-LD is in the first HTML response, once, with the FAQ' );
$stripped = $mounted; foreach ( $blocks as $b ) { $stripped = str_replace( $b, '', $stripped ); }
ok( $fx === $stripped, 'mount: nothing but the four blocks is added; every other element and id is untouched' );
operator_mount( $fx ); operator_enqueue();
ok( 3 === count( $GLOBALS['enq'] ), 'mount: the assets are still enqueued once, however many blocks are mounted and however often the content is rendered' );
ok( false !== strpos( $hsrc, "function operator_mount( \$content ) {\n\tif ( ! is_string( \$content ) || ! operator_is_page() ) {\n\t\treturn \$content;\n\t}\n\toperator_enqueue();\n\treturn operator_mount_blocks( \$content );" ), 'mount: off the page it returns the content untouched before anything else; on the page it enqueues the assets (operator_enqueue: once, on the page only)' );
ok( $mounted === operator_mount( $fx ), 'mount: a second render of the same content is filled the same way' );
ok( $mounted === operator_mount( $mounted ), 'mount: content that already holds the blocks is left alone (never twice)' );
$no_faq = operator_mount( $fixture( array( 'top', 'ph-rmn-calculator', 'independents', 'ph-rmn-tour' ) ) );
ok( 1 === substr_count( $no_faq, 'data-phf="calculator"' ) && 1 === substr_count( $no_faq, 'data-phf="tour"' ) && false === strpos( $no_faq, 'data-phf="faq"' ) && false === strpos( $no_faq, 'FAQPage' ), 'mount: a missing container is skipped silently; the others are still filled' );
$plain_fx = $fixture( array( 'top', 'why' ) );
ok( $plain_fx === operator_mount( $plain_fx ), 'mount: content with no mount container is returned unchanged' );
$widget = $fixture( array( 'top', 'ph-rmn-calculator' ) ) . '<div class="elementor-widget-shortcode"><div class="elementor-shortcode">' . operator_calculator_html() . '</div></div>';
ok( $widget === operator_mount( $widget ), 'mount: a container plus a Shortcode widget renders the block once (the widget\'s)' );
$two = operator_mount( $fixture( array( 'ph-rmn-faq', 'ph-rmn-faq' ) ) );
ok( 1 === substr_count( $two, 'data-phf="faq"' ) && 1 === substr_count( $two, 'FAQPage' ), 'mount: two containers with the same id still get the block once' );
$look = '<div class="elementor"><style>#ph-rmn-tour{padding:0}</style><div data-id="ph-rmn-tour" class="ph-rmn-tour"><a href="#ph-rmn-tour">x</a></div></div>';
ok( $look === operator_mount( $look ), 'mount: only an element whose id attribute is the CSS ID is a container (not a class, a data-id, a link or a style rule)' );
ok( null === operator_mount( null ) && '' === operator_mount( '' ), 'mount: empty content is passed through' );
// Only on the resolved page: another page, a plain page on the slug, and no page at all are untouched.
$other = new \WP_Post(); $other->ID = 99; $other->post_name = 'about-us'; $GLOBALS['qo'] = $other;
ok( $fx === operator_mount( $fx ), 'mount: another page with the same container ids is untouched' );
$GLOBALS['qo'] = $el; $GLOBALS['is_page'] = false;
ok( $fx === operator_mount( $fx ), 'mount: off the page (not is_page) the content is untouched' );
$fresh(); $plain = $mkpage( 10776, '' ); $GLOBALS['is_page'] = true; $GLOBALS['qo'] = $plain;
ok( $fx === operator_mount( $fx ), 'mount: a plain (non-Elementor) page on the slug is untouched' );
$fresh(); $GLOBALS['is_page'] = true;
ok( $fx === operator_mount( $fx ), 'mount: with no page the content is untouched' );
ok( ! $GLOBALS['page_writes'] && ! $GLOBALS['posts'] && ! $GLOBALS['updated'], 'mount: no post is written' );
ok( false !== strpos( $hsrc, "add_filter( 'elementor/frontend/the_content', __NAMESPACE__ . '\\\\operator_mount', 20 );" ), "mount: hooked on Elementor's frontend content filter" );
$fresh();


/* No redirect from the page's earlier URL: it was never public, so it is a 404 */
ok( array( '/retail-media-platform' ) === array_keys( redirect_map() ), 'redirects.php: only the retail media platform move is mapped' );
ok( ! in_array( '/run-your-own-rmn/', redirect_map(), true ) && '' === redirect_target( '/run-your-own-rmn/' ), 'nothing redirects to or from /run-your-own-rmn/' );
ok( ! preg_match( '/fr[a]nch/i', (string) file_get_contents( $dir . '/redirects.php' ) ), 'redirects.php never names the retired offer' );

/* Launched 15 Nov 2026: OPERATOR_LIVE ships true, so with no filter the page is live: indexable, in both sitemaps, the header item on
   every page, and llms.txt, the twin, the agent endpoint, robots.txt and the golf tour name it. One pass then forces it hidden through
   the ph_operator_live filter, and every one of those goes back to hidden. */
ok( true === OPERATOR_LIVE, 'OPERATOR_LIVE ships true (launched 15 Nov 2026)' );
ok( ! array_key_exists( 'ph_operator_live', $GLOBALS['filters'] ) && true === operator_is_live(), 'live by default: operator_is_live() with no filter' );
$d = $mkpage( 7 );
operator_sync_state();
ok( ! isset( $GLOBALS['meta'][7]['_seopress_robots_index'] ) && 'live:7' === $GLOBALS['opts']['ph_operator_state'], 'live (default): no SEOPress noindex on the page, state live' );
ok( ! isset( operator_sitemap_args( array( 'post_type' => 'page' ) )['post__not_in'] ), 'live (default): in the WordPress and SEOPress sitemap queries' );
$GLOBALS['is_page'] = true; $GLOBALS['qo'] = $d;
$r = operator_robots( array( 'index' => true, 'follow' => true ) );
ok( empty( $r['noindex'] ) && ! empty( $r['index'] ), 'live (default): wp_robots indexable on /run-your-own-rmn/' );
ok( false === strpos( $hsrc, "if ( operator_is_live() && ! headers_sent() )" ) && false !== strpos( $hsrc, "if ( ! operator_is_live() && ! headers_sent() ) {\n\t\t\theader( 'X-Robots-Tag: noindex' );" ), 'X-Robots-Tag noindex is sent on the page only while not live' );
ok( 'Run Your Own Retail Media Network (RMN) - Personalisation Hub' === operator_document_title( 'Old - Personalisation Hub' ), 'document title "Run Your Own Retail Media Network (RMN) - Personalisation Hub" on the page' );
$other = new \WP_Post(); $other->ID = 99; $other->post_name = 'about-us'; $GLOBALS['qo'] = $other;
ok( ! isset( operator_robots( array( 'index' => true ) )['noindex'] ) && 'T' === operator_document_title( 'T' ), 'another page: keyed by the resolved id, so untouched' );
$GLOBALS['qo'] = $d;
$GLOBALS['is_page'] = false;
ok( array( 'index' => true ) === operator_robots( array( 'index' => true ) ), 'other pages: robots unchanged' );
ok( 'Home | X' === operator_document_title( 'Home | X' ), 'other pages: title unchanged' );
$hmk = function ( $id, $title, $url, $parent = 0 ) { return (object) array( 'ID' => $id, 'db_id' => $id, 'title' => $title, 'url' => $url, 'menu_item_parent' => (string) $parent, 'classes' => array( 'menu-item' ), 'current' => false, 'menu_order' => 0 ); };
$hdr = function () use ( $hmk ) { return array( $hmk( 1, 'Features', '/features/' ), $hmk( 3, 'Industry', '/industries/' ), $hmk( 4, 'Telco', '/industries/telco/', 3 ), $hmk( 5, 'Support', '/support-centre/' ), $hmk( 6, 'Blog', '/blog/' ) ); };
$top = function ( $items ) { return implode( ',', array_map( function ( $i ) { return $i->title; }, array_filter( $items, function ( $i ) { return '0' === (string) $i->menu_item_parent; } ) ) ); };
ok( 'Features,Industry,Run Your Own RMN,Support,Blog' === $top( operator_menu_objects( $hdr(), operator_is_page(), operator_is_live() ) ), 'live (default): a non-operator page\'s header gets "Run Your Own RMN" between Industry and Support' );
$wp_robots0 = "User-agent: *\nDisallow: /wp-admin/\n";
ok( false !== strpos( operator_llms_filter( "## Pricing and trial\n", operator_is_live() && operator_page_id() > 0 ), '## Run your own RMN' ), 'live (default): llms.txt gets the "Run your own RMN" section' );
ok( is_array( operator_agent_page( operator_is_live() ) ), 'live (default): the agent endpoint lists the page and its twin' );
ok( false !== strpos( robots_txt_text( $wp_robots0, true, operator_robots_allow( array(), operator_is_live() && operator_page_id() > 0 ) ), 'Allow: /run-your-own-rmn/' ), 'live (default): robots.txt allows /run-your-own-rmn/ for AI agents' );
$tours = ai_tours();
ok( isset( $tours['rmn'] ) && 5 === count( $tours ) && false !== strpos( ai_tours_llms_md(), '/run-your-own-rmn/' ) && '' !== ai_tour_section( 'rmn' ), 'live (default): the golf tour joins llms.txt and the twins' );
ok( 1 === ( new \DOMXPath( ( function () { $x = new \DOMDocument(); @$x->loadHTML( '<?xml encoding="utf-8"?><html><head>' . operator_head_html( array( 'url' => 'https://x.test/i.webp', 'width' => 1200, 'height' => 630, 'alt' => 'x' ), operator_is_live() ) . '</head></html>' ); return $x; } )() ) )->query( '//link[@type="text/markdown"]' )->length, 'live (default): the head links the markdown twin' );

/* Forced hidden through the ph_operator_live filter: everything back to hidden */
$GLOBALS['filters']['ph_operator_live'] = false;
ok( false === operator_is_live(), 'ph_operator_live false: hidden' );
operator_sync_state();
ok( 'yes' === ( $GLOBALS['meta'][7]['_seopress_robots_index'] ?? '' ) && 'hidden:7' === $GLOBALS['opts']['ph_operator_state'], 'forced hidden: SEOPress noindex set on the page' );
$args = operator_sitemap_args( array( 'post_type' => 'page' ) );
ok( array( 7 ) === ( $args['post__not_in'] ?? null ), 'forced hidden: left out of the sitemap queries' );
$GLOBALS['is_page'] = true; $GLOBALS['qo'] = $d;
$r = operator_robots( array( 'index' => true, 'follow' => true ) );
ok( ! empty( $r['noindex'] ) && ! isset( $r['index'] ), 'forced hidden: wp_robots noindex on /run-your-own-rmn/' );
$GLOBALS['is_page'] = false;
ok( 'Features,Industry,Support,Blog' === $top( operator_menu_objects( $hdr(), operator_is_page(), operator_is_live() ) ), 'forced hidden: a non-operator page\'s header is unchanged' );
ok( "## Pricing and trial\n" === operator_llms_filter( "## Pricing and trial\n", operator_is_live() && operator_page_id() > 0 ), 'forced hidden: llms.txt unchanged' );
ok( null === operator_agent_page( operator_is_live() ), 'forced hidden: the agent endpoint gets nothing' );
ok( false === strpos( robots_txt_text( $wp_robots0, true, operator_robots_allow( array(), operator_is_live() && operator_page_id() > 0 ) ), 'run-your-own-rmn' ), 'forced hidden: robots.txt does not name the page' );
ok( ! isset( ai_tours()['rmn'] ) && 4 === count( ai_tours() ) && false === strpos( ai_tours_llms_md(), 'run-your-own-rmn' ) && '' === ai_tour_section( 'rmn' ), 'forced hidden: the golf tour is out of llms.txt and the twins' );
ok( 0 === ( new \DOMXPath( ( function () { $x = new \DOMDocument(); @$x->loadHTML( '<?xml encoding="utf-8"?><html><head>' . operator_head_html( array( 'url' => 'https://x.test/i.webp', 'width' => 1200, 'height' => 630, 'alt' => 'x' ), operator_is_live() ) . '</head></html>' ); return $x; } )() ) )->query( '//link[@type="text/markdown"]' )->length, 'forced hidden: no twin link in the head' );
$GLOBALS['filters']['ph_operator_live'] = true;
operator_sync_state();
ok( ! isset( $GLOBALS['meta'][7]['_seopress_robots_index'] ) && 'live:7' === $GLOBALS['opts']['ph_operator_state'], 'back to live: SEOPress noindex removed again' );
unset( $GLOBALS['filters']['ph_operator_live'] ); $GLOBALS['is_page'] = false;

/* Header menu (the page exists: $d, id 7) */
$mk = function ( $id, $title, $url, $parent = 0, $cur = false ) { return (object) array( 'ID' => $id, 'db_id' => $id, 'title' => $title, 'url' => $url, 'menu_item_parent' => (string) $parent, 'classes' => $cur ? array( 'menu-item', 'current-menu-item' ) : array( 'menu-item' ), 'current' => $cur, 'menu_order' => 0 ); };
$header = array( $mk( 1, 'Features', '/features/' ), $mk( 2, 'Digital signage', '/digital-signage/', 1 ), $mk( 3, 'Industry', '/industries/' ), $mk( 4, 'Telco', '/industries/telco/', 3 ), $mk( 5, 'Support', '/support-centre/' ), $mk( 6, 'Blog', '/blog/' ) );
$footer = array( $mk( 11, 'Privacy policy', '/privacy-policy/' ), $mk( 12, 'Support', '/support-centre/' ) );
$titles = function ( $items ) { return implode( ',', array_map( function ( $i ) { return $i->title; }, array_filter( $items, function ( $i ) { return '0' === (string) $i->menu_item_parent; } ) ) ); };
ok( $titles( operator_menu_objects( $header, false, false ) ) === 'Features,Industry,Support,Blog', 'hidden: other pages\' header menu unchanged' );
$on = operator_menu_objects( array_map( function ( $o ) { return clone $o; }, $header ), true, false );
ok( $titles( $on ) === 'Features,Industry,Run Your Own RMN,Support,Blog', 'hidden: on /run-your-own-rmn/ the item "Run Your Own RMN" sits between Industry and Support' );
$fi = array_values( array_filter( $on, function ( $i ) { return 'Run Your Own RMN' === $i->title; } ) )[0];
ok( 'https://personalisationhub.com/run-your-own-rmn/' === $fi->url && true === $fi->current && in_array( 'current-menu-item', $fi->classes, true ) && '0' === $fi->menu_item_parent, 'item: /run-your-own-rmn/, top level, current-menu-item' );
ok( ! preg_match( '/fr[a]nch/i', implode( ' ', $fi->classes ) . ' ' . $fi->title . ' ' . $fi->url . ' ' . $fi->attr_title ), 'item: no retired offer name in its title, URL, title attribute or classes' );
ok( array( 'aria-current' => 'page' ) === operator_menu_link_atts( array(), $fi ), 'item: aria-current="page"' );
ok( array() === operator_menu_link_atts( array(), $header[0] ), 'other items: no aria-current added' );
ok( $titles( operator_menu_objects( $footer, true, false ) ) === 'Privacy policy,Support', 'footer menu untouched even on /run-your-own-rmn/' );
ok( $titles( operator_menu_objects( array_map( function ( $o ) { return clone $o; }, $header ), false, true ) ) === 'Features,Industry,Run Your Own RMN,Support,Blog', 'live: the item shows on every page' );
$live_other = operator_menu_objects( array_map( function ( $o ) { return clone $o; }, $header ), false, true );
ok( false === array_values( array_filter( $live_other, function ( $i ) { return 'Run Your Own RMN' === $i->title; } ) )[0]->current, 'live, another page: not marked current' );
$twice = operator_menu_objects( $on, true, false );
ok( 1 === count( array_filter( $twice, function ( $i ) { return 'Run Your Own RMN' === $i->title; } ) ), 'never added twice' );
$hand = array_merge( array_map( function ( $o ) { return clone $o; }, $header ), array( $mk( 7, 'Run your own RMN', 'https://personalisationhub.com/run-your-own-rmn/' ) ) );
ok( 1 === count( array_filter( operator_menu_objects( $hand, true, true ), function ( $i ) { return false !== strpos( $i->url, '/run-your-own-rmn/' ); } ) ), 'a menu already linking /run-your-own-rmn/ is left alone (the check matches the new path)' );

/* The blocks: copy, defaults and no commercial terms (the rest of the page is Elementor; see the build brief below) */
$html = operator_calculator_html() . operator_faq_html() . operator_tour_html();
$text = html_entity_decode( strip_tags( str_replace( '<', ' <', preg_replace( '#<script[^>]*>.*?</script>#s', '', $html ) ) ), ENT_QUOTES );
$order = array( 'Benefits calculator', 'What could it be worth to you?', 'Your network', 'Running your own RMN', 'What is a retail media network?', 'How do I get started?', 'Interactive product tour', 'See a retail media network run end to end', 'Unlock the product tour' );
$pos = -1; $in_order = true;
foreach ( $order as $s ) { $p2 = strpos( $text, $s ); if ( false === $p2 || $p2 < $pos ) { $in_order = false; fwrite( STDERR, "  order: $s\n" ); } $pos = (int) $p2; }
ok( $in_order, 'the blocks\' copy, in order' );
foreach ( array( 'calculator' => operator_calculator_html(), 'faq' => operator_faq_html(), 'tour' => operator_tour_html() ) as $k => $b ) {
	ok( 0 === strpos( $b, '<div class="phf phf-block" data-phf="' . $k . '">' ) && '</div>' === substr( $b, -6 ), "block $k: one .phf wrapper (scopes operator.css, found by operator.js)" );
	ok( false === strpos( $b, '<h1' ) && ! preg_match( '/id="(top|why|who|how|venues|standards|independents)"/', $b ), "block $k: no H1 and none of the Elementor sections' anchors" );
}
ok( false !== strpos( operator_calculator_html(), 'id="calculator"' ) && false !== strpos( operator_faq_html(), 'id="faq"' ) && false !== strpos( operator_tour_html(), 'id="tour"' ), 'anchors #calculator, #faq and #tour come with their blocks' );
foreach ( array( 'Your head start in a changing industry', 'Three ways to run your own network', 'Built to fix retail media', 'Give independents a fighting chance', 'Why it beats anything out there', OPERATOR_HERO_P ) as $s ) { ok( false === strpos( html_entity_decode( $html, ENT_QUOTES ), $s ), 'static copy is Elementor\'s now, not rendered by a block: ' . substr( $s, 0, 40 ) ); }
foreach ( array( '$591K', '>90<', '>270<', '2,190,000', '3,942,000', '$59.1M' ) as $s ) { ok( false !== strpos( operator_calculator_html(), $s ), "calculator: server-rendered default $s" ); }
foreach ( array( '/setup fee (of|is)\b/i', '/minimum/i', '/\bsplit\b/i', '/\d+\s*%\s*(of|share)/i', '/50\s*%/', '/0\.5/', '/half/i', '/PH\'s share/i' ) as $re ) { ok( ! preg_match( $re, $text ), "no commercial term in the blocks: $re" ); }
ok( false !== strpos( $html, 'I agree to be contacted. See the <a href="/privacy-policy/">privacy policy</a>.' ), 'consent line links the privacy policy' );
ok( 7 === substr_count( $html, '<option>' ) && 7 === substr_count( substr( $html, strpos( $html, 'id="t-bg"' ) ), '<option>' ), 'the gate\'s only options are the 7 backgrounds' );
$tour_html = html_entity_decode( operator_tour_html(), ENT_QUOTES );
preg_match_all( '#<label for="t-[a-z]+">([^<]+)</label>#', $tour_html, $tl );
ok( array( 'Full name', 'Email', 'LinkedIn profile (optional)', 'Where you plan to operate', 'Your background' ) === $tl[1], 'gate: the fields, with no "I am": ' . implode( ' | ', $tl[1] ) );
ok( false === strpos( $tour_html, 't-ia' ) && false === strpos( $tour_html, 'name="audience"' ) && false === strpos( $tour_html, 'An individual operator' ) && false === strpos( $tour_html, '>I am<' ), 'gate: no "I am" select, no audience field, none of its options' );
ok( false !== strpos( $tour_html, '<div class="phf-f phf-f-wide"><label for="t-bg">Your background</label>' ), 'gate: "Your background" spans both columns, so the five fields leave no empty slot' );
ok( false !== strpos( $tour_html, '<option>Retail media</option><option>Creative agency</option><option>Retail business owner or manager</option><option>Marketing</option><option>Something else</option></select>' ), 'gate: the backgrounds in the design\'s order' );
/* The calculator's "I am" toggle and its two modes */
$calc_html = operator_calculator_html();
ok( false !== strpos( $calc_html, '<p class="phf-cin-h">Your network</p><div class="phf-aud" role="group" aria-label="I am"><button type="button" class="phf-aud-b" data-aud="operator" aria-pressed="true">Operator or team</button><button type="button" class="phf-aud-b" data-aud="retailer" aria-pressed="false">Retailer</button></div><p class="phf-cgrp">Your figures</p>' ), 'calculator: the "I am" toggle under "Your network": a group of two buttons, "Operator or team" pressed by default' );
ok( false !== strpos( $calc_html, '<span data-lab="venues">Venues in your network</span>' ) && false !== strpos( $calc_html, '<span data-lab="extraSales">Extra sales for your venues a year</span>' ), 'calculator: the operator labels are server-rendered, on the rows the toggle renames' );
ok( 'Stores in your network' === operator_calc_outputs( 'retailer' )['venues'] && 'Extra sales in your stores a year' === operator_calc_outputs( 'retailer' )['extraSales'] && 'Venues in your network' === operator_calc_outputs()['venues'] && 'Extra sales for your venues a year' === operator_calc_outputs()['extraSales'], 'calculator: the retailer and operator labels' );
$rc = operator_calc( operator_defaults(), 'retailer' );
ok( 59957820.0 === round( $rc['income'], 1 ) && '$60.0M' === operator_view( $rc )['yours'] && '$59.1M' === operator_view( $rc )['extraSales'], 'retailer mode at the defaults: income = its share of ad revenue plus extra sales = $60.0M' );
ok( operator_calc( operator_defaults() ) === operator_calc( operator_defaults(), 'operator' ) && '$591K' === operator_view( operator_calc( operator_defaults(), 'anything else' ) )['yours'], 'operator is the default mode' );
ok( ' For retailers, those extra sales in your stores are added to your income.' === substr( OPERATOR_HOW_CALC, -strlen( ' For retailers, those extra sales in your stores are added to your income.' ) ) && false !== strpos( html_entity_decode( $calc_html, ENT_QUOTES ), OPERATOR_HOW_CALC ), '"How it\'s calculated" ends with the retailer sentence' );
foreach ( array( '/0\.7/', '/0\.5/' ) as $re ) { ok( ! preg_match( $re, $html ) && ! preg_match( $re, $mounted ), "no share constant in the blocks' HTML (text, attributes, JSON-LD): $re" ); }
foreach ( array( '/70\s*%/', '/\b0?\.7\b/', '/seventy/i' ) as $re ) { ok( ! preg_match( $re, $text ), "no retailer share in the blocks' text: $re" ); }
ok( false !== strpos( $html, 'name="website"' ) && false !== strpos( $html, 'LinkedIn profile (optional)' ), 'honeypot and optional LinkedIn' );
ok( ! preg_match( '/personaliz|organiz/i', $text ), 'UK spelling' );
ok( ! preg_match( '/fr[a]nch/i', $html ), 'the blocks (text and every attribute) never name the retired offer' );
foreach ( array( '<p class="phf-cin-h">Your network</p>', '<p class="phf-gate-p">Tell us a little about yourself to watch the full walkthrough. Our team will also follow up with more on the opportunity.</p>' ) as $s ) {
	ok( false !== strpos( html_entity_decode( $html, ENT_QUOTES ), $s ), 'exact copy: ' . substr( $s, 0, 70 ) );
}
ok( 9 === substr_count( operator_calculator_html(), 'role="tooltip"' ), 'a tooltip on every input, on How it\'s calculated and on Earnings per display per month' );
$c = operator_calc( operator_defaults() );
ok( 591300.0 === round( $c['income'], 1 ) && 59130000.0 === round( $c['extraSales'], 1 ), 'operator_calc defaults' );
ok( '$950' === operator_money( 950 ) && '$1K' === operator_money( 1000 ) && '$1.0M' === operator_money( 1e6 ), 'money format' );

/* The Elementor build brief (ph-website/elementor/run-your-own-rmn.md): every line the twin publishes, the anchors and the blocks in order */
$bf = dirname( __DIR__ ) . '/elementor/run-your-own-rmn.md';
$brief = is_file( $bf ) ? (string) file_get_contents( $bf ) : '';
ok( '' !== $brief, 'the build brief exists: ph-website/elementor/run-your-own-rmn.md' );
$lines = array_merge( array( OPERATOR_H1, OPERATOR_SUBLINE, OPERATOR_HERO_P, OPERATOR_WAYS_INTRO, OPERATOR_VENUES_P ), OPERATOR_HEAD_START, OPERATOR_STANDARDS_LEADS, OPERATOR_INDEP_LEADS, OPERATOR_INDEP_BAND );
foreach ( array_merge( operator_why_items(), operator_ways(), operator_standards(), operator_independents() ) as $w ) { $lines[] = '"' . $w[1] . '": "' . $w[2] . '"'; }
foreach ( operator_steps() as $st ) { $lines[] = $st[0] . '. "' . $st[1] . '": "' . $st[2] . '"'; }
foreach ( OPERATOR_VENUE_TYPES as $v ) { $lines[] = '"' . $v . '"'; }
foreach ( $lines as $l ) { ok( false !== strpos( $brief, $l ), 'brief carries the twin\'s line word for word: ' . substr( $l, 0, 60 ) ); }
ok( 12 === count( OPERATOR_VENUE_TYPES ) && 4 === count( operator_why_items() ) && 3 === count( operator_ways() ) && 3 === count( operator_steps() ) && 8 === count( operator_standards() ) && 4 === count( operator_independents() ), '12 venues, four "why" items, three ways, three steps, eight standards cards, four independents cards' );
ok( 'Without the upfront cost' === OPERATOR_SUBLINE && 0 === strpos( OPERATOR_HERO_P, 'AI has changed what one person can achieve (the rise of the solopreneur).' ) && array( 'Individual operator', 'Operator team', 'Small to medium retailer' ) === array_column( operator_ways(), 1 ) && array( 'Get set up', 'Roll out with a free runway', 'Grow on outcomes' ) === array_column( operator_steps(), 1 ) && array( 'Your brand, your data, your network', 'AI-native, with full MCP support', 'A dedicated engineering team behind you' ) === array_slice( array_column( operator_standards(), 1 ), 5 ), 'the 14 Nov copy: sub-line, hero paragraph, the three ways, the steps and standards cards 6 to 8' );
foreach ( array( '(max width 16ch', 'columns at least 260px wide', 'columns at least 300px wide (3 per row on desktop)', 'background Navy, White text, radius 12px, padding 36px 40px, margin bottom 32px', 'flex 1 1 280px, 26px, weight 600', 'flex 2 1 480px, 18px, On dark', '`elementor-build-composition`', '`_cssid`' ) as $w ) { ok( false !== strpos( $brief, $w ), "brief layout: $w" ); }
ok( false === strpos( $brief, 'Shortcode widget `[' ) && false === strpos( $brief, 'world-leading' ) && false === strpos( $brief, 'Built for people who know media' ) && false === strpos( $brief, 'Secure, with no lock-in' ), 'brief: no Shortcode widget section and none of the replaced copy' );
ok( false !== strpos( $brief, '**H1**: "Run your own retail media network"' ) && 1 === substr_count( $brief, '**H1**' ), 'brief: one H1, "Run your own retail media network"' );
$marks = array( 'CSS ID `top`', 'CSS ID `why`', 'CSS ID `who`', 'CSS ID `how`', 'CSS ID `venues`', 'CSS ID `standards`', 'mount container, CSS ID `ph-rmn-calculator`', 'CSS ID `independents`', 'mount container, CSS ID `ph-rmn-faq`', 'mount container, CSS ID `ph-rmn-tour`' );
$pos = -1; $in = true;
foreach ( $marks as $m ) { $q = strpos( $brief, $m ); if ( false === $q || $q < $pos ) { $in = false; fwrite( STDERR, "  brief order: $m\n" ); } $pos = (int) $q; }
ok( $in, 'brief: the sections in order, each with its anchor, and the three mount containers where they go' );
foreach ( array( 'elementor-create-page', '`elementor_header_footer`', '`_elementor_edit_mode` is `builder`', 'global colours and global fonts', 'Kantumruy Pro', 'elementor-get-page-structure', 'never writes a post' ) as $w ) { ok( false !== strpos( $brief, $w ), "brief: $w" ); }
foreach ( array( "Built to fix retail media's fragmentation", 'Give independents a fighting chance', 'Three ways to run your own network', 'Your head start in a changing industry', 'Any business with a physical presence', 'Standardised measurement', 'AI-native, with full MCP support', 'A way to fight back' ) as $w ) { ok( false !== strpos( $brief, $w ), "brief copy: $w" ); }
ok( ! preg_match( '/fr[a]nch/i', $brief ) && ! preg_match( '/own[ ]boss|be-your[-]own/i', $brief ), 'brief: neither the retired offer name nor the previous page name' );
foreach ( array( '/setup fee/i', '/\b50\s*%/', '/0\.5/', '/\b70\s*%/', '/0\.7/', '/PH\'s share/i' ) as $re ) { ok( ! preg_match( $re, $brief ), "brief: no commercial term $re" ); }

/* The static agent files never name the page: only operator.php adds it, and only once live (below) */
foreach ( array( 'llms.php', 'md.php', 'ld.php', 'ai-surface.php', 'ai-hygiene.php', 'calculators.php' ) as $f ) {
	$fs = (string) file_get_contents( $dir . '/' . $f );
	ok( ! preg_match( '/fr[a]nch/i', $fs ) && false === stripos( $fs, 'run-your-own-rmn' ), "$f does not mention the page" );
}
$al = (string) file_get_contents( dirname( __DIR__ ) . '/snippets/ph-agent-endpoint/lib.php' );
ok( ! preg_match( '/fr[a]nch/i', $al ) && false === stripos( $al, 'run-your-own-rmn' ), 'agent endpoint allow-list does not include it (it is added through ph_agent_extra_pages, only when live)' );

/* Title and menu */
ok( 'Run Your Own RMN' === OPERATOR_TITLE && 'Run Your Own Retail Media Network (RMN) - Personalisation Hub' === OPERATOR_DOC_TITLE && 'run-your-own-rmn' === OPERATOR_SLUG && '/run-your-own-rmn/' === OPERATOR_PATH, 'constants: slug, path, title and document title' );
$mi = operator_menu_item( true, 1 );
ok( 'Run Your Own RMN' === $mi->title && in_array( 'ph-rmn-item', $mi->classes, true ), 'menu item "Run Your Own RMN", class ph-rmn-item' );

/* SEO on the page */
ok( strlen( OPERATOR_META_DESC ) <= 155 && preg_match( '/[a-z]\.$/', OPERATOR_META_DESC ) && 0 === strpos( OPERATOR_META_DESC, 'Run your own retail media network (RMN)' ), 'meta description: 155 characters or fewer (' . strlen( OPERATOR_META_DESC ) . '), ends on a full word, leads with "Run your own retail media network (RMN)"' );
ok( 'Run your own retail media network (RMN) on a white-label platform with real-time in-store personalisation. Estimate your earnings and take the tour.' === OPERATOR_META_DESC, 'meta description exact' );
$img  = operator_og_image();
ok( 'https://personalisationhub.com/wp-content/uploads/2026/11/home-hero-bg.webp' === $img['url'] && '' !== $img['alt'], 'og:image falls back to the home hero (shows content), with alt text' );
$GLOBALS['opts']['page_on_front'] = 2389; $GLOBALS['meta'][2389] = array( '_seopress_social_fb_img' => 'https://personalisationhub.com/wp-content/uploads/social.jpg' );
ok( 'https://personalisationhub.com/wp-content/uploads/social.jpg' === operator_og_image()['url'], "og:image: the site's own social image when the home page has one" );
unset( $GLOBALS['opts']['page_on_front'], $GLOBALS['meta'][2389] );
$GLOBALS['opts']['seopress_social_option_name'] = array( 'seopress_social_facebook_img' => 'https://personalisationhub.com/wp-content/uploads/default-social.jpg', 'seopress_social_knowledge_img' => 'https://personalisationhub.com/logo.png' );
ok( 'https://personalisationhub.com/wp-content/uploads/default-social.jpg' === operator_og_image()['url'], "og:image: else SEOPress's default social image (never the logo)" );
unset( $GLOBALS['opts']['seopress_social_option_name'] );
$headf = function ( $live ) use ( $img ) {
	$dom = new \DOMDocument();
	@$dom->loadHTML( '<?xml encoding="utf-8"?><html><head>' . operator_head_html( $img, $live ) . '</head><body></body></html>' );
	$x = new \DOMXPath( $dom );
	return $x;
};
$hx  = $headf( false );
$one = function ( $q ) use ( $hx ) { $n = $hx->query( $q ); return 1 === $n->length ? $n->item( 0 ) : null; };
$c   = function ( $q, $attr = 'content' ) use ( $one ) { $n = $one( $q ); return $n ? $n->getAttribute( $attr ) : null; };
ok( OPERATOR_META_DESC === $c( '//meta[@name="description"]' ), 'one meta description' );
ok( 'https://personalisationhub.com/run-your-own-rmn/' === $c( '//link[@rel="canonical"]', 'href' ), 'one canonical: https://personalisationhub.com/run-your-own-rmn/' );
ok( 'Run Your Own Retail Media Network (RMN)' === $c( '//meta[@property="og:title"]' ) && OPERATOR_META_DESC === $c( '//meta[@property="og:description"]' ) && 'https://personalisationhub.com/run-your-own-rmn/' === $c( '//meta[@property="og:url"]' ), 'og:title, og:description (= meta description), og:url' );
ok( $img['url'] === $c( '//meta[@property="og:image"]' ) && $img['alt'] === $c( '//meta[@property="og:image:alt"]' ) && 'summary_large_image' === $c( '//meta[@name="twitter:card"]' ), 'og:image, og:image:alt, twitter:card summary_large_image' );
ok( 0 === $hx->query( '//link[@type="text/markdown"]' )->length && 1 === $headf( true )->query( '//link[@type="text/markdown"]' )->length, 'the twin is linked from the head only when live' );
$ldn = $hx->query( '//script[@type="application/ld+json"]' );
ok( 1 === $ldn->length, 'one JSON-LD script' );
$ld = json_decode( $ldn->item( 0 )->textContent, true );
ok( is_array( $ld ) && 'https://schema.org' === $ld['@context'] && is_array( $ld['@graph'] ), 'JSON-LD is valid JSON with an @graph' );
$byType = array(); foreach ( $ld['@graph'] as $n ) { $byType[ $n['@type'] ] = $n; }
$ids = array_column( $ld['@graph'], '@id' );
foreach ( array( 'WebPage', 'Service', 'BreadcrumbList' ) as $t ) { ok( isset( $byType[ $t ] ), "head JSON-LD has a $t" ); }
ok( ! isset( $byType['FAQPage'] ), 'the head JSON-LD has no FAQPage: the FAQ block prints it, once' );
$wp = $byType['WebPage'];
ok( 'en-GB' === $wp['inLanguage'] && in_array( $wp['isPartOf']['@id'], $ids, true ) && 'WebSite' === $byType['WebSite']['@type'] && 'https://personalisationhub.com/#website' === $wp['isPartOf']['@id'] && 'Retail media network' === $wp['about']['name'], 'WebPage: en-GB, isPartOf the WebSite, about "Retail media network"' );
$sv = $byType['Service'];
ok( 'Run your own retail media network' === $sv['name'] && 'White-label retail media network platform' === $sv['serviceType'] && 'https://personalisationhub.com/#organization' === $sv['provider']['@id'] && in_array( $sv['provider']['@id'], $ids, true ), 'Service: name, serviceType, provider = the Organization' );
ok( false === strpos( json_encode( $ld ), 'areaServed' ), 'no areaServed anywhere (the business is global)' );
$bl = $byType['BreadcrumbList']['itemListElement'];
ok( 2 === count( $bl ) && 'Home' === $bl[0]['name'] && 'https://personalisationhub.com/' === $bl[0]['item'] && 'Run Your Own RMN' === $bl[1]['name'] && 'https://personalisationhub.com/run-your-own-rmn/' === $bl[1]['item'], 'BreadcrumbList: Home › Run Your Own RMN' );
// [ph_operator_faq]: the FAQPage JSON-LD it prints equals its visible questions, word for word, and is part of the page's WebPage.
$dom = new \DOMDocument(); @$dom->loadHTML( '<?xml encoding="utf-8"?>' . operator_faq_html() ); $px = new \DOMXPath( $dom );
$fl = $px->query( '//script[@type="application/ld+json"]' );
ok( 1 === $fl->length, 'the FAQ block prints one JSON-LD script' );
$faqld = json_decode( $fl->item( 0 )->textContent, true );
ok( is_array( $faqld ) && 'https://schema.org' === $faqld['@context'] && 'FAQPage' === $faqld['@type'] && 'https://personalisationhub.com/run-your-own-rmn/#faq' === $faqld['@id'] && $wp['@id'] === $faqld['isPartOf']['@id'] && 'en-GB' === $faqld['inLanguage'], 'FAQ JSON-LD: valid FAQPage, isPartOf the WebPage' );
$byType['FAQPage'] = $faqld;
$visible = array();
$faqCta  = array();
foreach ( $px->query( '//section[@id="faq"]//details' ) as $det ) {
	$paras = array();
	foreach ( $px->query( './/div[contains(@class,"phf-faq-a")]/p', $det ) as $pp ) { $paras[] = trim( $pp->textContent ); }
	$visible[] = array( trim( $px->query( './/summary', $det )->item( 0 )->textContent ), implode( ' ', $paras ) );
	$links     = $px->query( './/div[contains(@class,"phf-faq-a")]//a', $det );
	$faqCta[]  = $links->length ? array( $links->item( 0 )->getAttribute( 'href' ), trim( $links->item( 0 )->textContent ), $links->item( 0 )->getAttribute( 'class' ), $links->length ) : null;
}
// The JSON-LD answer may carry the CTA as an <a>; its text without tags is what the page shows.
$ldq = array_map( function ( $q ) { return array( $q['name'], trim( strip_tags( $q['acceptedAnswer']['text'] ) ) ); }, $byType['FAQPage']['mainEntity'] );
ok( 13 === count( $visible ) && $visible === $ldq, 'FAQPage equals the visible FAQ (' . count( $visible ) . ' questions)' );
ok( 'Running your own RMN' === trim( $px->query( '//section[@id="faq"]//h2' )->item( 0 )->textContent ), 'FAQ titled "Running your own RMN"' );
// Rob's 15 Nov 2026 rewrite (B9eyzr7i3Rgkl7EQ5idN): thirteen questions and answers, word for word and in this order.
$faqWant = array(
	array( 'What is a retail media network?', 'A business selling advertising to brands across the places it reaches its customers: in-store screens and, for retailers, their website and app. What makes it retail media is the data: campaigns are targeted using first-party data about the venue and its customers, and, where sales data is shared, measured against what actually sells. When you run your own, you bring many independent venues together so brands can buy them as one network.' ),
	array( 'Who can run their own RMN?', 'An individual operator building a network across many venues of one kind, such as golf clubs. An operator team, ideally a retail media expert, an ad sales expert and an IT operations expert. Or a small to medium retailer that wants its own retail media network across its stores, website and app without enterprise costs. Whichever you are, the strongest applicants know their industry well and have existing relationships to build on.' ),
	array( 'How do I make money?', 'You sell direct to brands: each brand buys screen time across your network through a direct advertiser deal, by slot, at a fixed CPM (cost per thousand views) over an agreed period. Endemic brands, the ones your venues sell, are the natural first buyers because their ads can drive sales on the spot, but any brand that wants the audience can buy. The more venues and screens you add, the more you can earn.' ),
	array( 'What\'s in it for the venues?', 'A share of the advertising revenue you agree with them, slots to promote their own products and services, and promotions that adapt to the moment, such as time of day and weather, to lift sales. They don\'t have to find advertisers or run campaigns: that\'s your job.' ),
	array( 'What does it cost to get started?', 'There\'s a one-off platform setup fee, which keeps places for serious applicants ready to commit. After that you have a free roll-out runway to sign up venues and win your first advertisers before monthly platform fees apply, and those fees are based on outcomes, so we only grow when you do. Your other costs are your own AWS hosting, which scales with your network, and hardware. The full commercial terms for your industry are in the information pack.' ),
	array( 'What hardware do I need?', 'Every screen needs a media player to run your network\'s content, so even venues that already have screens need one plugged in. Players such as Amazon Signage are now low cost, and the platform runs on any signage player. Venues without screens also need a commercial display; we\'ll introduce you to recommended hardware partners for your industry.' ),
	array( 'Who pays for the screens and players?', 'It doesn\'t have to be you. A brand can fund the hardware as part of its advertising deal. A brand can commit to category exclusivity across your network for a set period, for example the only golf ball brand on screen for 12 months, which funds the roll-out. Or venues can buy their own. The information pack covers what works best in your industry.' ),
	array( 'Can I get exclusive rights to an industry?', 'Networks are set up by region and industry, and sized to the audience their venues reach. Exclusivity goes to people who know that industry and already have relationships with its venues and the brands that sell through them, because those relationships are what launch and grow a network. Places are limited, and you keep your exclusivity by hitting the agreed roll-out and growth milestones.' ),
	array( 'Which industries can I choose?', 'Any business with a physical location where people shop or spend time: car dealerships, golf clubs, sailing clubs and marinas, fuel and convenience, trade suppliers, rural and farm supplies, independent grocery, liquor stores, hardware, utility shopfronts, gyms and leisure centres, and cafés and bakeries. Your industry shapes the venues, hardware, advertisers and roll-out, so we ask for it when you request further information.' ),
	array( 'What do I get?', 'The white-label platform, under your brand and in your own AWS account, with the playbooks, templates and sales framework to launch. Campaigns are created by talking a brief to the AI campaign agent, which builds the creative for every screen type, and they can adapt to context such as time, weather and local stock. Venue and customer data stays in your account, and the network and its advertiser relationships are yours.' ),
	array( 'How do advertisers know it works?', 'Every campaign reports plays and views by screen and venue. Where a venue shares its sales data, results are matched to sales of the advertised products, which is what brands pay a premium for.' ),
	array( 'How does the earnings estimate work?', 'The calculator multiplies venues, visitors per venue per day, the share who view the ads and displays per venue to get monthly ad views, then applies the CPM to get ad revenue. Your potential income is your share of that, before costs. It also estimates extra sales from personalised offers, which Retailer mode adds to the retailer\'s potential incremental income. It\'s an estimate to explore the opportunity, not a forecast.' ),
	array( 'How do I get started?', 'Request further information and tell us your industry and the relationships you have in it. We\'ll send an information pack with the commercial model, exclusivity, hardware options and roll-out plan, then book a 20-minute call. Places are limited in each industry, so request your pack now.' ),
);
ok( array_column( $faqWant, 0 ) === array_column( $visible, 0 ), 'FAQ: the thirteen questions in the brief\'s order' );
foreach ( $faqWant as $i => $want ) {
	ok( $want === array_slice( operator_faq()[ $i ], 0, 2 ), 'FAQ copy word for word: ' . $want[0] );
	ok( ( 12 === $i ? $want[1] . ' Request further information' : $want[1] ) === $visible[ $i ][1], 'FAQ shows, word for word: ' . $want[0] );
}
$faqCopy = array( 12 => $faqWant[12][1] );
ok( $visible[12][1] === $faqCopy[12] . ' Request further information', '"How do I get started?" shows its answer, then the "Request further information" link' );
ok( array( '#request-info', 'Request further information', 'phf-pill', 1 ) === $faqCta[12] && 12 === count( array_filter( array_slice( $faqCta, 0, 12 ), 'is_null' ) ), 'FAQ: only "How do I get started?" has a link, one pink pill "Request further information" to #request-info' );
$lastLd = $byType['FAQPage']['mainEntity'][12]['acceptedAnswer']['text'];
ok( $faqCopy[12] . ' <a href="https://personalisationhub.com/run-your-own-rmn/#request-info">Request further information</a>' === $lastLd, 'FAQ JSON-LD: the last answer carries the same link, absolute: ' . substr( $lastLd, -110 ) );
ok( 1 === count( array_filter( $byType['FAQPage']['mainEntity'], function ( $q ) { return false !== strpos( $q['acceptedAnswer']['text'], '<' ); } ) ), 'FAQ JSON-LD: no other answer carries markup' );
$faqText = implode( ' ', array_merge( ...$visible ) );
ok( ! preg_match( '/\d/', str_replace( array( '20-minute', 'for 12 months' ), '', $faqText ) ), 'FAQ: no figures beyond the "20-minute" call and the brief\'s "for 12 months" exclusivity example (no fee, percentage or runway figure)' );
foreach ( array( '/0\.5/', '/50\s*%/', '/0\.7/', '/70\s*%/', '/%/', '/\$/', '/\bhalf\b/i', '/personaliz|organiz/i', '/fr[a]nch/i', '/\b(UK|Britain|British|America|Australia|United States|USA|New Zealand|Canada|Ireland)\b/', '/lock-?in/i', '/(setup|set-up) fee (of|is|costs?)\b/i', '/fee of\b/i', '/minimum/i', '/guarantee/i', '/revenue[- ]share/i', '/\bsplit\b/i', '/runway (of|for|lasts?) /i', '/\bDSPs?\b/', '/programmatic/i', '/\bMCP\b/', '/no large capital outlay/i' ) as $re ) { ok( ! preg_match( $re, $faqText ), "FAQ: nothing matching $re" ); }
ok( 1 === preg_match_all( '/\d+\s*months?/i', $faqText ) && false !== strpos( $faqText, 'the only golf ball brand on screen for 12 months' ), 'FAQ: the only month figure is the category exclusivity example, never a runway length' );
foreach ( array( 'first-party data' => 'first-party data', 'measured against what actually sells' => 'measurement against sales', 'individual operator' => 'individual operator', 'operator team' => 'operator team', 'small to medium retailer' => 'small to medium retailer', 'one-off platform setup fee, which keeps places for serious applicants' => 'the one-off setup fee (no amount)', 'free roll-out runway' => 'the free runway', 'based on outcomes, so we only grow when you do' => 'growing on outcomes', 'Every screen needs a media player' => 'every screen needs a player', 'A brand can fund the hardware' => 'funded hardware', 'Retailer mode adds to the retailer\'s potential incremental income' => 'the calculator\'s retailer mode', 'request further information' => 'the one next step' ) as $needle => $what ) { ok( false !== stripos( $faqText, $needle ), "FAQ states: $what" ); }
$GLOBALS['is_page'] = true; $GLOBALS['qo'] = $d;
ok( '' === operator_seopress_off( '<meta property="og:title" content="x">' ), "on the page SEOPress's own description, canonical, OG and Twitter tags are switched off" );
$GLOBALS['is_page'] = false;
ok( 'x' === operator_seopress_off( 'x' ), 'other pages: SEOPress untouched' );

/* llms.txt, the twin, the agent endpoint and robots.txt name the page only when live */
$llms = (string) require $dir . '/llms.php';
ok( $llms === operator_llms_filter( $llms, false ), 'hidden: llms.txt unchanged' );
$ll = operator_llms_filter( $llms, true );
ok( false !== strpos( $ll, "## Run your own RMN\n\n- [Run your own retail media network (RMN)](https://personalisationhub.com/run-your-own-rmn/?format=md): " ) && strpos( $ll, '## Run your own RMN' ) < strpos( $ll, '## Pricing and trial' ), 'live: llms.txt has a "Run your own RMN" section with the one entry, before Pricing and trial' );
ok( $ll === operator_llms_filter( $ll, true ) && 1 === substr_count( $ll, 'run-your-own-rmn' ), 'live: llms.txt section added once' );
$GLOBALS['pages'] = array(); $mkpage( 10900 );
ok( null === operator_agent_page( false ), 'hidden: the agent endpoint gets nothing' );
$ap = operator_agent_page( true );
ok( is_array( $ap ) && 'https://personalisationhub.com/run-your-own-rmn/' === $ap['url'] && 'Run your own retail media network (RMN)' === $ap['title'] && $ap['md'] === operator_twin(), 'live: the agent endpoint gets the page and its twin' );
$GLOBALS['meta'][10900]['_elementor_edit_mode'] = '';
ok( null === operator_agent_page( true ), 'live but no Elementor page: nothing' );
ok( array() === operator_robots_allow( array(), false ) && array( '/run-your-own-rmn/' ) === operator_robots_allow( array(), true ), 'robots.txt allow list: the page only when live' );
$wp_robots = "User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n";
ok( false === strpos( robots_txt_text( $wp_robots, true, operator_robots_allow( array(), false ) ), 'run-your-own-rmn' ) && false !== strpos( robots_txt_text( $wp_robots, true, operator_robots_allow( array(), true ) ), "Allow: /\nAllow: /run-your-own-rmn/\n" ), 'robots.txt: "Allow: /run-your-own-rmn/" in the AI agents\' group only when live' );
$tw = operator_twin();
ok( 0 === strpos( $tw, "# Run your own retail media network\n\n> " . OPERATOR_META_DESC . "\n\nSource: https://personalisationhub.com/run-your-own-rmn/" ), 'twin: H1, summary and source' );
foreach ( array( '## Key facts', '**Your brand, your own AWS account:**', "**Without the upfront cost.**\n\n" . OPERATOR_HERO_P, "## Your head start in a changing industry\n\n" . OPERATOR_HEAD_START[0] . "\n\n" . OPERATOR_HEAD_START[1], "## Three ways to run your own network\n\n" . OPERATOR_WAYS_INTRO, '- **Small to medium retailer:** Run your own omnichannel retail media network', '## How it works', '2. **Roll out with a free runway:** ', "## Built to fix retail media's fragmentation\n\n" . OPERATOR_STANDARDS_LEADS[0] . "\n\n" . OPERATOR_STANDARDS_LEADS[1], '- **A dedicated engineering team behind you:** ', "## Give independents a fighting chance\n\n" . OPERATOR_INDEP_LEADS[0] . "\n\n" . OPERATOR_INDEP_LEADS[1] . "\n\n**" . OPERATOR_INDEP_BAND[0] . '** ' . OPERATOR_INDEP_BAND[1], '- **A way to fight back:** ', '## Benefits calculator', 'Choose "Operator or team" or "Retailer"', '- Venues (90): ', "With the defaults, as \"Operator or team\", the page shows:\n\n- Your potential income a year: \$591K\n- Venues in your network: 90\n", '- Ad views a month: 3,942,000', '- Extra sales for your venues a year: $59.1M', "With the defaults, as \"Retailer\", the page shows:\n\n- Retailer's potential incremental income a year: \$60.0M\n- Stores in your network: 90\n", '- Extra sales in your stores a year: $59.1M', OPERATOR_HOW_CALC, 'estimate_rmn_earnings', '## FAQ', '## Interactive product tour', 'https://personalisationhub.com/run-your-own-rmn/#tour' ) as $want ) {
	ok( false !== strpos( $tw, $want ), 'twin has: ' . substr( $want, 0, 60 ) );
}
ok( false === strpos( $tw, 'which describes you' ) && false === strpos( $tw, 'individual operator, part of an operator team' ) && false === strpos( $tw, 'i_am' ), 'twin: the gate and the request form no longer mention the "I am" field' );
foreach ( operator_faq() as $qa ) { ok( false !== strpos( $tw, '### ' . $qa[0] . "\n\n" . $qa[1] ), 'twin FAQ: ' . $qa[0] ); }
ok( false !== strpos( $tw, '### How do I get started?' . "\n\n" . operator_faq()[12][1] . "\n\n[Request further information](https://personalisationhub.com/run-your-own-rmn/#request-info)\n\n## Interactive product tour" ) && 1 === substr_count( $tw, '](https://personalisationhub.com/run-your-own-rmn/#request-info)' ), 'twin FAQ: "How do I get started?" ends with the same link, as markdown' );
$twFaq = substr( $tw, strpos( $tw, "## FAQ\n" ), strpos( $tw, "## Interactive product tour" ) - strpos( $tw, "## FAQ\n" ) );
ok( 13 === substr_count( $twFaq, "\n### " ) && ! preg_match( '/lock-?in/i', $tw ), 'twin FAQ: thirteen questions, no "no lock-in"' );
foreach ( array( '/programmatic/i', '/\bDSPs?\b/', '/\bMCP\b/', '/%/', '/\$/', '/lock-?in/i' ) as $re ) { ok( ! preg_match( $re, $twFaq ), "twin FAQ: nothing matching $re" ); }
foreach ( array( '/programmatic/i', '/\bDSPs?\b/', '/\bMCP\b/', '/%/', '/\$/', '/lock-?in/i' ) as $re ) { ok( ! preg_match( $re, (string) wp_json_encode( operator_faq_ld() ) ) && ! preg_match( $re, implode( ' ', array_merge( ...operator_faq() ) ) ), "operator_faq() and its JSON-LD: nothing matching $re" ); }
ok( false !== strpos( $tw, OPERATOR_TOUR_P ) && 0 === strpos( OPERATOR_TOUR_P, 'Watch a network operator sell screens across 100 golf clubs, ' ), 'twin: the tour intro is the network operator\'s' );
foreach ( array( '/0\.5/', '/50\s*%/', '/0\.7/', '/70\s*%/', '/\bhalf\b/i', '/fr[a]nch/i', '/personaliz/i', '/network operator/i', '/world-leading/i' ) as $re ) { ok( ! preg_match( $re, str_replace( OPERATOR_TOUR_P, '', $tw ) ), "twin: nothing matching $re (no share constant, none of the replaced copy)" ); }
foreach ( $lines as $l ) { if ( '"' !== $l[0] && ! preg_match( '/^\d\. "/', $l ) ) { ok( false !== strpos( $tw, $l ), 'twin publishes the page\'s line: ' . substr( $l, 0, 60 ) ); } }
// 15 Nov 2026 (ayzaMouFF6U5CIsAMbSx): direct advertiser deals only (PH is not connected to any DSPs yet), Amazon Signage named.
ok( 'You sell direct to brands: each brand buys screen time across your network through a direct advertiser deal, by slot, at a fixed CPM (cost per thousand views) over an agreed period. Endemic brands, the ones your venues sell, are the natural first buyers because their ads can drive sales on the spot, but any brand that wants the audience can buy. The more venues and screens you add, the more you can earn.' === operator_faq()[2][1], 'FAQ Q3 "How do I make money?": direct advertiser deals at a fixed CPM, word for word' );
ok( 'Every screen needs a media player to run your network\'s content, so even venues that already have screens need one plugged in. Players such as Amazon Signage are now low cost, and the platform runs on any signage player. Venues without screens also need a commercial display; we\'ll introduce you to recommended hardware partners for your industry.' === operator_faq()[5][1], 'FAQ Q6 "What hardware do I need?": Amazon Signage, word for word' );
$cardSI = array_values( array_filter( operator_standards(), function ( $c ) { return 'Seamless integrations' === $c[1]; } ) );
ok( 1 === count( $cardSI ) && 'Connects to venues\' existing systems through open APIs, and runs on any signage player, including Amazon Signage.' === $cardSI[0][2], '"Seamless integrations" card matches the live Elementor card (page 10785, element 4ce4f48f)' );
ok( false !== strpos( $tw, '- **Seamless integrations:** ' . $cardSI[0][2] . "\n" ), 'twin: the "Seamless integrations" card\'s new copy' );
// 15 Nov 2026 (bB30Qb10Oz4eYHXfOCFk): the operator team is a retail media, an ad sales and an IT operations expert, matching the live Elementor card (page 10785, element 29becd9b).
$teamCard = 'Team up a retail media expert, an ad sales expert and an IT operations expert. Between you, you cover venues, advertisers and your retail media network, all focused on maximising the advertising revenue your venues earn and the in-store sales they make from the endemic brands they stock.';
$teamQ2   = 'An individual operator building a network across many venues of one kind, such as golf clubs. An operator team, ideally a retail media expert, an ad sales expert and an IT operations expert. Or a small to medium retailer that wants its own retail media network across its stores, website and app without enterprise costs. Whichever you are, the strongest applicants know their industry well and have existing relationships to build on.';
ok( 'Operator team' === operator_ways()[1][1] && $teamCard === operator_ways()[1][2], '"Operator team" card matches the live Elementor card (page 10785, element 29becd9b), word for word' );
ok( 'Who can run their own RMN?' === operator_faq()[1][0] && $teamQ2 === operator_faq()[1][1], 'FAQ Q2: the operator team is a retail media, an ad sales and an IT operations expert' );
ok( false !== strpos( $tw, '- **Operator team:** ' . $teamCard ) || false !== strpos( $tw, $teamCard ), 'twin: the "Operator team" card\'s new copy' );
ok( false !== strpos( $tw, '### Who can run their own RMN?' . "\n\n" . $teamQ2 ) && false !== strpos( (string) wp_json_encode( operator_faq_ld() ), 'an IT operations expert' ), 'twin and FAQPage JSON-LD: the new Q2' );
ok( false !== strpos( $brief, '"Operator team": "' . $teamCard . '"' ), 'brief: the "Operator team" card word for word' );
// 15 Nov 2026 (92tOS4qL1KqeOF3jPu24): Q2, Q8 and Q13 on expertise, existing relationships, and region and industry.
ok( 'Whichever you are, the strongest applicants know their industry well and have existing relationships to build on.' === substr( operator_faq()[1][1], -strlen( 'Whichever you are, the strongest applicants know their industry well and have existing relationships to build on.' ) ), 'FAQ Q2 ends on knowing the industry and existing relationships' );
ok( 'Can I get exclusive rights to an industry?' === operator_faq()[7][0] && 'Networks are set up by region and industry, and sized to the audience their venues reach. Exclusivity goes to people who know that industry and already have relationships with its venues and the brands that sell through them, because those relationships are what launch and grow a network. Places are limited, and you keep your exclusivity by hitting the agreed roll-out and growth milestones.' === operator_faq()[7][1], 'FAQ Q8 "Can I get exclusive rights to an industry?": region and industry, existing relationships, word for word' );
ok( 'How do I get started?' === operator_faq()[12][0] && 'Request further information and tell us your industry and the relationships you have in it. We\'ll send an information pack with the commercial model, exclusivity, hardware options and roll-out plan, then book a 20-minute call. Places are limited in each industry, so request your pack now.' === operator_faq()[12][1] && true === ( operator_faq()[12][2] ?? null ), 'FAQ Q13 "How do I get started?": your industry and the relationships you have in it, word for word, still linking #request-info' );
$faqAll = implode( ' ', array_merge( ...operator_faq() ) ) . ' ' . (string) wp_json_encode( operator_faq_ld() ) . ' ' . $tw;
ok( ! preg_match( '/industry first|then by region|first come, first served/i', $faqAll ), 'nothing in the FAQ, its JSON-LD or the twin says "industry first", "then by region" or "first come, first served"' );
ok( false !== strpos( $tw, '### Can I get exclusive rights to an industry?' . "\n\n" . operator_faq()[7][1] ) && false !== strpos( (string) wp_json_encode( operator_faq_ld() ), 'already have relationships with its venues' ), 'twin and FAQPage JSON-LD: the new Q8' );
$cae = array();
$it  = new \RecursiveIteratorIterator( new \RecursiveDirectoryIterator( dirname( __DIR__ ), \FilesystemIterator::SKIP_DOTS ) );
foreach ( $it as $file ) {
	$path = $file->getPathname();
	if ( false !== strpos( $path, '/node_modules/' ) || ! preg_match( '/\.(php|js|mjs|md|json|html|css|txt)$/', $path ) || in_array( basename( $path ), array( 'operator.test.php', 'operator.test.mjs' ), true ) ) { continue; }
	if ( false !== stripos( (string) file_get_contents( $path ), 'creative agency expert' ) ) { $cae[] = substr( $path, strlen( dirname( __DIR__ ) ) + 1 ); }
}
ok( array() === $cae && false === stripos( $tw, 'creative agency expert' ) && false === stripos( (string) wp_json_encode( operator_faq_ld() ), 'creative agency expert' ), 'nothing in ph-website/, the twin or the JSON-LD says "creative agency expert"' . ( $cae ? ' (found in ' . implode( ', ', $cae ) . ')' : '' ) );
$cardsText = implode( ' ', array_map( function ( $c ) { return $c[1] . ' ' . $c[2]; }, operator_standards() ) );
$ldText    = (string) wp_json_encode( operator_faq_ld(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
foreach ( array( 'cards' => $cardsText, 'FAQ' => implode( ' ', array_merge( ...operator_faq() ) ), 'twin' => $tw, 'FAQ JSON-LD' => $ldText ) as $where => $txt ) {
	ok( ! preg_match( '/programmatic/i', $txt ) && ! preg_match( '/\bDSPs?\b/', $txt ), "$where: no \"programmatic\" or \"DSP\"" );
}
ok( 2 === substr_count( implode( ' ', array_merge( ...operator_faq() ) ) . ' ' . $cardsText, 'Amazon Signage' ) && 1 === substr_count( operator_faq()[5][1], 'Amazon Signage' ) && 1 === substr_count( $cardsText, 'Amazon Signage' ), 'Amazon Signage only in Q6 and the "Seamless integrations" card' );
ok( 2 === substr_count( $tw, 'Amazon Signage' ) && 1 === substr_count( $ldText, 'Amazon Signage' ), 'twin: Amazon Signage twice (Q6 and the card); FAQ JSON-LD: once (Q6)' );
ok( 1 === preg_match( "/const PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063 = '1\.9\.28';/", (string) file_get_contents( $dir . '/main.php' ) ), 'main.php: assets version 1.9.28, so returning browsers fetch the new operator.js and operator.css' );
$src = (string) file_get_contents( $dir . '/operator.php' );
ok( false !== strpos( $src, "add_filter( 'ph_llms_txt'" ) && false !== strpos( $src, "add_filter( 'ph_agent_extra_pages'" ) && false !== strpos( $src, "add_filter( 'ph_ai_robots_allow'" ) && false !== strpos( $src, "|| ! operator_is_page() || ! operator_is_live() ) {" ), 'hooks: llms.txt, agent endpoint, robots.txt, and the twin served only on the page when live' );

/* The page's previous name is gone from ph-website/ (the ticket's grep, with bracketed patterns so this file never contains it) */
$hits = array();
foreach ( new \RecursiveIteratorIterator( new \RecursiveDirectoryIterator( dirname( __DIR__ ), \FilesystemIterator::SKIP_DOTS ) ) as $fi ) {
	if ( $fi->isFile() && preg_match( '/own[ ]boss|be-your[-]own|ph[-]boss/i', (string) file_get_contents( $fi->getPathname() ) ) ) {
		$hits[] = $fi->getPathname();
	}
}
ok( ! $hits, 'no file in ph-website/ names the page\'s previous name: ' . implode( ', ', $hits ) );
$main = (string) file_get_contents( $dir . '/main.php' );
ok( false !== strpos( $main, "require_once __DIR__ . '/operator.php';" ), 'main.php requires operator.php' );
$src = (string) file_get_contents( $dir . '/operator.php' );
ok( false !== strpos( $src, "add_filter( 'pre_get_document_title'" ) && false !== strpos( $src, "add_filter( 'seopress_titles_title'" ), 'hooks: document title and SEOPress title' );
ok( 'operator' === OPERATOR_SOURCE && 'ph_operator_page' === OPERATOR_PAGE_OPTION && 'ph_operator_state' === OPERATOR_STATE_OPTION && ! defined( __NAMESPACE__ . '\\OPERATOR_LOCK_OPTION' ) && ! defined( __NAMESPACE__ . '\\OPERATOR_MOVE_LOCK' ) && ! defined( __NAMESPACE__ . '\\OPERATOR_PAGE_ID' ), 'console key "operator", options ph_operator_page (the resolved id\'s cache) and ph_operator_state; no page id, page lock or move lock' );
ok( false !== strpos( $src, "apply_filters( 'ph_operator_live', OPERATOR_LIVE )" ) && false !== strpos( $src, "'ph-operator-10063'" ) && false !== strpos( $src, "'window.PH_OPERATOR = '" ) && false !== strpos( $src, "'endpoint' => '/wp-json/ph-site/v1/operator-lead'" ), 'filter ph_operator_live, handles ph-operator-10063, window.PH_OPERATOR, endpoint operator-lead' );
foreach ( array( 'operator.php', 'operator-content.php', 'operator.css', 'operator.js', 'main.php', 'leads.php', 'redirects.php', 'enhance.js' ) as $f ) {
	ok( ! preg_match( '/fr[a]nch/i', (string) file_get_contents( $dir . '/' . $f ) ), "$f never names the retired offer (code or comments)" );
}
foreach ( array( 'operator.php', 'operator-content.php', 'operator.css', 'operator.js' ) as $f ) { ok( is_file( $dir . '/' . $f ), "snippet file $f exists" ); }
ok( ! glob( $dir . '/fr[a]nch*' ), 'no snippet file is named after the retired offer' );
ok( false !== strpos( $src, "register_rest_route( 'ph-site/v1', '/operator-lead'" ), 'REST route ph-site/v1/operator-lead' );
ok( false !== strpos( $src, "add_filter( 'wp_robots'" ) && false !== strpos( $src, "header( 'X-Robots-Tag: noindex' )" ) && false !== strpos( $src, "'seopress_sitemaps_single_query'" ) && false !== strpos( $src, "'wp_sitemaps_posts_query_args'" ), 'hooks: wp_robots, X-Robots-Tag, both sitemaps' );
ok( false !== strpos( $src, "if ( \$done || ! operator_is_page() ) {\n\t\treturn;\n\t}\n\t\$done = true;\n\t\$ver  = PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063;" ) && false !== strpos( $src, "add_action( 'wp_enqueue_scripts', __NAMESPACE__ . '\\\\operator_enqueue' );" ), 'operator.css and operator.js load only on the page (in the head and from the blocks), with the assets version' );

/* 15 Nov 2026 (ticket qJHMfzBhoppVEWhTCrEL): the retailer income label, "Earnings per display per month" and the request form */
$fresh(); $reset(); $GLOBALS['tr'] = array();
// 1. The retailer income label, in the PHP-rendered panel's labels and the twin; the operator label unchanged.
ok( 'Retailer\'s potential incremental income a year' === operator_calc_outputs( 'retailer' )['yours'] && 'Your potential income a year' === operator_calc_outputs()['yours'], 'labels: "Retailer\'s potential incremental income a year" (Retailer), "Your potential income a year" (Operator or team)' );
$calc_html = operator_calculator_html();
ok( false !== strpos( $calc_html, '<p class="phf-cout-l" data-lab="yours">Your potential income a year</p><p class="phf-cout-v" data-out="yours">$591K</p>' ), 'panel: the income label is server-rendered in operator mode and carries data-lab="yours" (operator.js renames it with the toggle)' );
ok( false !== strpos( $tw = operator_twin(), "- Retailer's potential incremental income a year: \$60.0M" ) && false === strpos( $tw, '- Your potential income a year: $60.0M' ), 'twin: the retailer figure under the retailer label' );
$faq_calc = array_column( operator_faq(), 1, 0 )['How does the earnings estimate work?'];
ok( false !== strpos( $faq_calc, 'the retailer\'s potential incremental income' ) && ! preg_match( '/\d/', $faq_calc ), 'FAQ: the calculator answer names the retailer\'s potential incremental income, with no figure' );
// 3. Earnings per display per month: $183 at the defaults, below the CTA row, operator only; "–" with no displays.
$c = operator_calc( operator_defaults() );
ok( 270 === $c['displays'] && 183 === (int) round( $c['perDisplay'] ) && '$183' === operator_view( $c )['perDisplay'], 'per display: $591,300 a year / 270 displays / 12 = $183' );
ok( '$183' === operator_view( operator_calc( operator_defaults(), 'retailer' ) )['perDisplay'], 'per display: always the operator\'s income (the row is hidden in Retailer mode)' );
foreach ( array( array( 'dis' => 0 ), array( 'ven' => 0 ), array( 'ven' => 0, 'dis' => 0 ) ) as $z ) {
	$cz = operator_calc( array_merge( operator_defaults(), $z ) );
	ok( null === $cz['perDisplay'] && '–' === operator_view( $cz )['perDisplay'], 'per display: no displays gives "–" (never NaN or Infinity): ' . json_encode( $z ) );
}
ok( '$1K' === operator_per_display( 999.5 ) && '$2K' === operator_per_display( 1500 ) && '$183' === operator_per_display( 182.5 ) && '$0' === operator_per_display( 0.4 ), 'per display: whole dollars rounded half up, operator_money() from $1K' );
$ctas = strpos( $calc_html, '<div class="phf-cctas">' ); $perd = strpos( $calc_html, '<div class="phf-perd"' );
ok( false !== $ctas && false !== $perd && $perd > $ctas && $perd > strpos( $calc_html, 'See how it works' ), 'panel: the per-display row is below the CTA row' );
ok( false !== strpos( $calc_html, '<span class="phf-perd-l" data-lab="perDisplay">Earnings per display per month</span>' ) && false !== strpos( $calc_html, '<span class="phf-perd-v" data-out="perDisplay">$183</span>' ) && false === strpos( substr( $calc_html, $perd, 600 ), ' hidden' ), 'panel: "Earnings per display per month" $183, shown at the defaults (operator mode)' );
ok( false !== strpos( html_entity_decode( $calc_html, ENT_QUOTES ), 'id="c-perd-tip">Your potential income a year ÷ the displays in your network ÷ 12. Each display you add earns about this much a month.</span>' ), 'panel: the per-display tooltip' );
ok( false !== strpos( $calc_html, '<a class="phf-pill" href="#request-info">Request further information</a>' ), 'calculator CTA "Request further information" goes to #request-info' );
ok( 'Earnings per display per month' === operator_calc_outputs()['perDisplay'] && ! isset( operator_calc_outputs( 'retailer' )['perDisplay'] ), 'outputs: per display in operator mode only' );
ok( false !== strpos( $tw, "- Earnings per display per month: \$183\n" ) && 1 === substr_count( $tw, 'Earnings per display per month' ), 'twin: the default per-display figure, in operator mode only' );
// 2. The request form block.
$rq = operator_request_html(); $rqt = html_entity_decode( $rq, ENT_QUOTES );
ok( 0 === strpos( $rq, '<div class="phf phf-block" data-phf="request"><section id="request-info" class="phf-sec phf-tint" aria-labelledby="req-h">' ), 'request block: .phf wrapper, a full-width section with anchor #request-info' );
foreach ( array( '<p class="phf-eb">Request further information</p>', '<h2 id="req-h" class="phf-h2b phf-h2-req">Talk to us about running your own RMN</h2>', '<p class="phf-req-p">Tell us which industry you want to run your network in and we\'ll send you an information pack with the full detail, then book a 20-minute call to go through it. Places are limited in each industry.</p>', '>Request further information</button>', 'I agree to be contacted. See the <a href="/privacy-policy/">privacy policy</a>.', 'name="website"', 'LinkedIn profile (optional)', 'Anything you\'d like us to know (optional)</label><textarea id="r-ms" name="message" rows="4" maxlength="1000"', 'data-ok="We\'ll send your information pack shortly."' ) as $w ) { ok( false !== strpos( $rqt, $w ), 'request block: ' . substr( $w, 0, 70 ) ); }
$labels = array(); preg_match_all( '#<label for="r-[a-z]+">([^<]+)</label>#', $rqt, $lm ); $labels = $lm[1];
ok( array( 'Full name', 'Email', 'LinkedIn profile (optional)', 'Where you plan to operate', 'Industry you want to run your network in', 'Your industry', 'Your background', 'Anything you\'d like us to know (optional)' ) === $labels, 'request block: the fields in order, industry after "Where you plan to operate": ' . implode( ' | ', $labels ) );
preg_match( '#<select id="r-in" name="industry" required>(.*?)</select>#', $rqt, $im ); preg_match_all( '#<option>([^<]+)</option>#', $im[1] ?? '', $io );
ok( array( 'Car dealerships', 'Golf clubs', 'Sailing clubs and marinas', 'Fuel and convenience', 'Trade suppliers', 'Rural and farm supplies', 'Independent grocery', 'Liquor stores', 'Hardware', 'Utility shopfronts', 'Gyms and leisure centres', 'Cafés and bakeries', 'Other (tell us)' ) === $io[1] && operator_industries() === $io[1], 'request block: the twelve industries, then "Other (tell us)"' );
ok( false !== strpos( $rqt, '<div class="phf-f" id="r-io-f" hidden><label for="r-io">Your industry</label>' ) && 7 === substr_count( substr( $rqt, strpos( $rqt, 'id="r-bg"' ) ), '<option>' ), 'request block: the "Other" input hidden until chosen; seven backgrounds' );
ok( false === strpos( $rqt, 'r-ia' ) && false === strpos( $rqt, 'name="audience"' ) && false === strpos( $rqt, 'An individual operator' ) && false === strpos( $rqt, '>I am<' ), 'request block: no "I am" select, no audience field, none of its options' );
foreach ( array( '/0\.5/', '/0\.7/', '/50\s*%/', '/70\s*%/', '/fr[a]nch/i', '/personaliz|organiz/i' ) as $re ) { ok( ! preg_match( $re, $rq ) && ! preg_match( $re, $calc_html ), "request block and calculator: nothing matching $re" ); }
ok( false !== strpos( $tw, "## Request further information\n\nTalk to us about running your own RMN: " ) && false !== strpos( $tw, 'https://personalisationhub.com/run-your-own-rmn/#request-info' ), 'twin: the request form, with how to use it' );
// The request block fills #ph-rmn-request exactly once, after the tour, on the resolved page only.
$fresh(); $el = $mkpage( 10785 ); $GLOBALS['is_page'] = true; $GLOBALS['qo'] = $el;
$m4 = operator_mount( $fixture( $all_ids ) );
ok( 1 === substr_count( $m4, 'data-phf="request"' ) && 1 === substr_count( $m4, 'id="request-info"' ) && strpos( $m4, 'data-phf="tour"' ) < strpos( $m4, 'data-phf="request"' ), 'mount: the request block once, inside #ph-rmn-request, after the tour' );
ok( $m4 === operator_mount( $m4 ), 'mount: the request block is never added twice' );
$GLOBALS['is_page'] = false; ok( false === strpos( operator_mount( $fixture( $all_ids ) ), 'data-phf="request"' ), 'mount: off the page the request container is not filled' );
$fresh(); $reset(); $GLOBALS['tr'] = array();
// REST with form "request": every field validated as the gate's, plus the industry and the message.
$rgood = array_merge( $good, array( 'form' => 'request', 'industry' => 'Golf clubs', 'industry_other' => '', 'message' => 'We run nine clubs in Yorkshire.', 'email' => 'req@x.test' ) );
foreach ( array(
	array( 'name', '' ), array( 'email', 'nope' ), array( 'linkedin', 'https://example.com/in/ada' ), array( 'region', '' ), array( 'background', 'Astronaut' ),
	array( 'industry', '' ), array( 'industry', 'Pubs' ), array( 'industry_other', '' ), array( 'industry_other', str_repeat( 'x', 121 ) ), array( 'message', str_repeat( 'm', 1001 ) ), array( 'consent', false ),
) as $cse ) {
	$bd = array_merge( $rgood, array( $cse[0] => $cse[1] ) );
	if ( 'industry_other' === $cse[0] ) { $bd['industry'] = 'Other (tell us)'; }
	list( $st, $out ) = $call( $bd );
	ok( 400 === $st && $cse[0] === ( $out['field'] ?? '' ) && '' !== ( $out['error'] ?? '' ), "request: 400 with field {$cse[0]} for " . substr( var_export( $cse[1], true ), 0, 30 ) );
}
ok( ! $GLOBALS['posts'] && ! $GLOBALS['fired'] && ! $GLOBALS['mails'], 'request: invalid submissions store, fire and mail nothing' );
list( $st ) = $call( array_merge( $rgood, array( 'message' => str_repeat( 'é', 1000 ), 'email' => 'max@x.test' ) ) );
ok( 200 === $st, 'request: a 1,000-character message is accepted (characters, not bytes)' );
list( $st ) = $call( array_merge( $rgood, array( 'message' => '', 'email' => 'nomsg@x.test' ) ) );
ok( 200 === $st, 'request: the message is optional' );
$reset();
list( $st, $out ) = $call( array_merge( $rgood, array( 'website' => 'spam' ) ) );
ok( 200 === $st && ! empty( $out['ok'] ) && ! $GLOBALS['posts'] && ! $GLOBALS['fired'] && ! $GLOBALS['mails'], 'request: the honeypot pretends success and stores nothing' );
$GLOBALS['tr'] = array();
for ( $i = 0; $i < 10; $i++ ) { $call( array_merge( $rgood, array( 'email' => "rq$i@x.test" ) ), '8.8.8.8' ); }
list( $st ) = $call( $rgood, '8.8.8.8' ); ok( 429 === $st, 'request: the throttle applies (the 11th in an hour answers 429)' );
$GLOBALS['tr'] = array(); $reset();
list( $st ) = $call( $rgood );
$m = $GLOBALS['meta'][1]; $p = $GLOBALS['fired'][0][1];
ok( 200 === $st && 'Golf clubs' === $m['ph_lead_network_industry'] && 'We run nine clubs in Yorkshire.' === $m['ph_lead_message'] && 'operator' === $m['ph_lead_source'] && 'Network operator inquiry' === $m['ph_lead_source_label'], 'request: a Network operator inquiry, with the industry and the message on the lead' );
ok( 'Network operator inquiry' === $m['ph_lead_activity'][0]['label'] && 'Run Your Own RMN page – request further information' === $m['ph_lead_activity'][0]['detail'], 'request: activity "Network operator inquiry", detail "Run Your Own RMN page – request further information"' );
ok( 'Run Your Own RMN page – request further information' === $p['source_detail'] && 'request' === $p['form'] && 'Golf clubs' === $p['network_industry'] && 'We run nine clubs in Yorkshire.' === $p['message'] && 'operator' === $p['lead_type'] && 'Run Your Own RMN page – request further information' === lead_ingest_body( $p )['sourceDetail'], 'request: the payload and the console body carry the request source detail' );
ok( 1 === count( $GLOBALS['mails'] ) && 'New network operator inquiry (request): Ada Lovelace' === $GLOBALS['mails'][0][1] && false !== strpos( $GLOBALS['mails'][0][2], "\nIndustry: Golf clubs\n" ) && false !== strpos( $GLOBALS['mails'][0][2], "\nMessage: We run nine clubs in Yorkshire.\n" ) && false !== strpos( $GLOBALS['mails'][0][2], 'Source: Run Your Own RMN page – request further information' ), 'request: admin email "New network operator inquiry (request)" with the industry and the message' );
// A repeat submission (and a gate lead first) is activity on the one lead, never a second lead.
list( $st ) = $call( array_merge( $rgood, array( 'message' => 'A second note.', 'industry' => 'Other (tell us)', 'industry_other' => 'Pubs' ) ) );
$m = $GLOBALS['meta'][1];
ok( 200 === $st && 1 === count( $GLOBALS['posts'] ) && 2 === count( $m['ph_lead_activity'] ) && 'Run Your Own RMN page – request further information' === $m['ph_lead_activity'][1]['detail'], 'request: a repeat is recorded as activity on the same lead' );
ok( "We run nine clubs in Yorkshire.\n\nA second note." === $m['ph_lead_message'] && 'Golf clubs' === $m['ph_lead_network_industry'] && 'Other: Pubs' === $GLOBALS['fired'][1][1]['network_industry'], 'request: a repeat keeps every message; "Other (tell us)" sends the industry they named' );
$reset();
$call( array_merge( $good, array( 'email' => 'both@x.test' ) ) ); // the tour gate first
list( $st ) = $call( array_merge( $rgood, array( 'email' => 'both@x.test' ) ) );
ok( 200 === $st && 1 === count( $GLOBALS['posts'] ) && array( 'Run Your Own RMN page – product tour', 'Run Your Own RMN page – request further information' ) === array_column( $GLOBALS['meta'][1]['ph_lead_activity'], 'detail' ) && 'Golf clubs' === $GLOBALS['meta'][1]['ph_lead_network_industry'], 'gate then request: one lead, two activity rows, the industry added' );
$reset();
list( $st ) = $call( array_merge( $rgood, array( 'test' => true, 'email' => 'rt@x.test' ) ) );
ok( 200 === $st && '1' === $GLOBALS['meta'][1]['ph_lead_test'] && true === $GLOBALS['fired'][0][1]['test'] && ! $GLOBALS['mails'], 'request: test mode flags the lead and sends no admin email' );
$reset();
list( $st ) = $call( array_merge( $good, array( 'email' => 'gate@x.test' ) ) );
ok( 'tour' === $GLOBALS['fired'][0][1]['form'] && 'Run Your Own RMN page – product tour' === $GLOBALS['fired'][0][1]['source_detail'] && 'New network operator inquiry: Ada Lovelace' === $GLOBALS['mails'][0][1] && ! isset( $GLOBALS['meta'][1]['ph_lead_network_industry'] ), 'the tour gate is unchanged (no industry asked, its own source detail and email subject)' );
$reset();

// (15 Nov 2026) The unlocked state above the tour says the guided tour is ready, never "You're in" (it read as approval to run a network).
$in = html_entity_decode( operator_tour_html(), ENT_QUOTES );
ok( false !== strpos( $in, '<p class="phf-in-h" id="phf-in-h" tabindex="-1">Thanks. Your guided tour is ready.</p><p class="phf-in-p">Three short demos, about two minutes each. Choose one below to start.</p>' ), 'unlocked block: "Thanks. Your guided tour is ready." and the line below it' );
foreach ( array( 'tour block' => $in, 'twin' => operator_twin() ) as $k => $v ) { ok( ! preg_match( '/You(\'|’|&#39;|&rsquo;)re in/i', $v ), "no \"You're in\" in the $k" ); }
foreach ( glob( dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/operator*' ) as $f ) { ok( ! preg_match( '/You(\'|’|&#39;|&rsquo;)re in/i', file_get_contents( $f ) ), 'no "You\'re in" in ' . basename( $f ) ); }

if ( $fails ) {
	fwrite( STDERR, "operator.test.php: $fails of $count checks failed\n" );
	exit( 1 );
}
echo "operator.test.php: $count checks passed\n";
}
