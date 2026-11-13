<?php
/**
 * php ph-website/tests/franchise.test.php : the hidden /franchise/ page (snippet 10063, franchise.php).
 * POST ph-site/v1/franchise-lead validation (400 with the field), optional and normalised LinkedIn, the background allow-list, honeypot,
 * 429, personal email accepted, one lead per person in both orders, the ph_lead_captured payload and the console ingest body (leadType),
 * the test flag and no admin mail in test, idempotent page creation behind the lock, the header menu item (only on /franchise/ while
 * hidden, everywhere when live), noindex while hidden, sitemaps, and nothing in llms.txt, the twins or the agent endpoint.
 */
namespace {
error_reporting( E_ALL );
define( 'ABSPATH', '/' );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'OBJECT', 'OBJECT' );
define( 'PH_FRANCHISE_TEST', 1 );
$fails = 0;
$count = 0;
function ok( $c, $m ) { global $fails, $count; $count++; if ( ! $c ) { $fails++; fwrite( STDERR, "FAIL: $m\n" ); } }
$dir = dirname( __DIR__ ) . '/snippets/ph-industry-enhancements';

$GLOBALS['opts'] = array( 'admin_email' => 'a@x.test' ); $GLOBALS['tr'] = array(); $GLOBALS['posts'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['fired'] = array(); $GLOBALS['mails'] = array(); $GLOBALS['filters'] = array();
function add_action( $n, $cb ) {} function add_filter() {} function register_setting() {} function add_settings_field() {} function current_user_can() { return false; }
function apply_filters( $n, $v ) { return array_key_exists( $n, $GLOBALS['filters'] ) ? $GLOBALS['filters'][ $n ] : $v; }
function wp_unslash( $v ) { return $v; } function sanitize_text_field( $v ) { return trim( strip_tags( (string) $v ) ); }
function sanitize_email( $v ) { return trim( (string) $v ); } function is_email( $v ) { return (bool) filter_var( $v, FILTER_VALIDATE_EMAIL ); }
function get_transient( $k ) { return $GLOBALS['tr'][ $k ] ?? false; } function set_transient( $k, $v ) { $GLOBALS['tr'][ $k ] = $v; }
function wp_insert_post( $a ) { $GLOBALS['posts'][] = $a; $id = count( $GLOBALS['posts'] ); if ( ! empty( $a['meta_input'] ) ) { foreach ( $a['meta_input'] as $k => $v ) { $GLOBALS['meta'][ $id ][ $k ] = $v; } } return $id; }
function wp_update_post( $a ) { $GLOBALS['updated'][] = $a; return $a['ID']; }
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
function get_page_by_path( $p ) { foreach ( $GLOBALS['pages'] as $pg ) { if ( $pg->post_name === $p ) { return $pg; } } return null; }
class WP_Post { public $ID; public $post_name; public $post_parent = 0; public $post_type = 'page'; public $post_status = 'publish'; }
$GLOBALS['is_page'] = false; $GLOBALS['qo'] = null;
function is_page() { return $GLOBALS['is_page']; } function get_queried_object() { return $GLOBALS['qo']; }

require $dir . '/leads.php';
require $dir . '/franchise.php';
}

namespace AngieSnippets\PhIndustryEnhancements_10063 {
$n_ip = 0;
$call = function ( array $b, $ip = null ) use ( &$n_ip ) { $_SERVER['REMOTE_ADDR'] = $ip ?? '10.0.0.' . ( ++$n_ip ); return franchise_handle( $b ); };
$good = array( 'name' => 'Ada Lovelace', 'email' => 'ada@gmail.com', 'linkedin' => 'linkedin.com/in/ada', 'region' => 'Manchester and the North West', 'background' => 'Retail media', 'consent' => true, 'page' => '/franchise/', 'test' => false, 'website' => '' );
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
	list( $okl, $v ) = franchise_linkedin( $in );
	ok( $okl && $want === $v, "linkedin '$in' -> '$want' (got '$v')" );
}
list( $st ) = $call( array_merge( $good, array( 'linkedin' => '' ) ) ); ok( 200 === $st, 'LinkedIn left blank is accepted' );
$reset();

/* Background allow-list */
foreach ( FRANCHISE_BACKGROUNDS as $bg ) {
	list( $st ) = $call( array_merge( $good, array( 'background' => $bg, 'email' => 'bg' . md5( $bg ) . '@x.test' ) ) );
	ok( 200 === $st, "background accepted: $bg" );
}
ok( 5 === count( FRANCHISE_BACKGROUNDS ), 'exactly five backgrounds' );
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
ok( 'Ada Lovelace' === $m['ph_lead_name'] && 'ada@gmail.com' === $m['ph_lead_email'] && 'https://linkedin.com/in/ada' === $m['ph_lead_linkedin'] && 'Manchester and the North West' === $m['ph_lead_region'] && 'Retail media' === $m['ph_lead_background'], 'meta: name, email, linkedin, region, background' );
ok( 'franchise' === $m['ph_lead_source'] && 'Franchise opportunity' === $m['ph_lead_source_label'] && 1 === $m['ph_lead_consent'] && '/franchise/' === $m['ph_lead_page'] && ! isset( $m['ph_lead_test'] ), 'meta: source, label, consent, page, not test' );
ok( 'Franchise opportunity' === $m['ph_lead_activity'][0]['label'] && 'Franchise page – product tour' === $m['ph_lead_activity'][0]['detail'], 'activity row "Franchise opportunity"' );
$p = $GLOBALS['fired'][0];
ok( 'ph_lead_captured' === $p[0], 'fires ph_lead_captured' );
$p = $p[1];
foreach ( array( 'company' => 'Ada Lovelace', 'company_industry' => 'Franchise opportunity', 'industry' => 'franchise', 'contact_name' => 'Ada Lovelace', 'email' => 'ada@gmail.com', 'linkedin' => 'https://linkedin.com/in/ada', 'countries' => 'Manchester and the North West', 'job_title' => 'Retail media', 'source_label' => 'Franchise opportunity', 'source_detail' => 'Franchise page – product tour', 'lead_type' => 'franchise', 'page' => '/franchise/', 'test' => false ) as $k => $v ) {
	ok( array_key_exists( $k, $p ) && $v === $p[ $k ], "payload $k = " . var_export( $v, true ) );
}
ok( 1 === count( $GLOBALS['mails'] ) && 'New franchise enquiry: Ada Lovelace' === $GLOBALS['mails'][0][1] && 'a@x.test' === $GLOBALS['mails'][0][0], 'admin email "New franchise enquiry: <name>"' );

/* Ingest body */
$body = lead_ingest_body( $p );
foreach ( array( 'company' => 'Ada Lovelace', 'industry' => 'Franchise opportunity', 'countries' => 'Manchester and the North West', 'contactName' => 'Ada Lovelace', 'jobTitle' => 'Retail media', 'email' => 'ada@gmail.com', 'linkedin' => 'https://linkedin.com/in/ada', 'page' => '/franchise/', 'pageIndustry' => 'franchise', 'sourceLabel' => 'Franchise opportunity', 'sourceDetail' => 'Franchise page – product tour', 'leadType' => 'franchise', 'region' => 'Manchester and the North West', 'background' => 'Retail media' ) as $k => $v ) {
	ok( isset( $body[ $k ] ) && $v === $body[ $k ], "ingest body $k" );
}
ok( ! isset( $body['test'] ), 'ingest body: no test flag for a real lead' );
$other = lead_ingest_body( array( 'company' => 'Nimbus', 'name' => 'Ada', 'email' => 'a@n.test', 'industry' => 'telco', 'source_label' => 'Interactive product tour – Telco' ) );
ok( ! isset( $other['leadType'] ) && ! isset( $other['region'] ) && ! isset( $other['background'] ), 'other pages\' bodies are unchanged (no leadType, region, background)' );

/* One lead per person, both orders */
$reset();
$GLOBALS['meta'][1] = array( 'ph_lead_email' => 'grace@orbit.example', 'ph_lead_company' => 'Orbit', 'ph_lead_source' => 'interactive-product-tour', 'ph_lead_activity' => array( array( 'label' => 'Interactive product tour – Retail Media', 'detail' => '', 'at' => 'x' ) ) );
$GLOBALS['posts'][] = array( 'post_type' => 'ph_lead' );
list( $st ) = $call( array_merge( $good, array( 'email' => 'grace@orbit.example', 'name' => 'Grace Hopper' ) ) );
ok( 200 === $st && 1 === count( $GLOBALS['posts'] ), 'industry tour then franchise: no second lead' );
$acts = $GLOBALS['meta'][1]['ph_lead_activity'];
ok( 2 === count( $acts ) && 'Franchise opportunity' === $acts[1]['label'], 'industry tour then franchise: an activity row is added' );
ok( 'interactive-product-tour' === $GLOBALS['meta'][1]['ph_lead_source'] && 'Orbit' === $GLOBALS['meta'][1]['ph_lead_company'] && 'Retail media' === $GLOBALS['meta'][1]['ph_lead_background'], 'the existing lead keeps its source and company and gains the franchise fields' );
ok( 1 === (int) $GLOBALS['fired'][0][1]['post_id'], 'payload names the existing lead' );
// franchise then industry tour (tour.php adds activity to the same lead)
$reset();
list( $st ) = $call( array_merge( $good, array( 'email' => 'lin@x.test' ) ) );
ok( 1 === lead_find_existing( 'lin@x.test', false ), 'franchise then industry: lead_find_existing finds the franchise lead' );
lead_add_activity( 1, 'Interactive product tour – Telco', 'Personalisation' );
ok( 2 === count( $GLOBALS['meta'][1]['ph_lead_activity'] ) && 1 === count( $GLOBALS['posts'] ), 'franchise then industry: one lead, two activity rows' );

/* Test flag */
$reset();
list( $st ) = $call( array_merge( $good, array( 'test' => true, 'email' => 'test@x.test' ) ) );
ok( 200 === $st && '1' === $GLOBALS['meta'][1]['ph_lead_test'] && true === $GLOBALS['fired'][0][1]['test'] && ! $GLOBALS['mails'], 'test: flagged, test in the payload, no admin email' );
ok( true === lead_ingest_body( $GLOBALS['fired'][0][1] )['test'], 'test: ingest body carries test' );
list( $st ) = $call( array_merge( $good, array( 'test' => '1', 'email' => 'test@x.test' ) ) );
ok( 1 === count( $GLOBALS['posts'] ), 'test leads dedupe among test leads' );
list( $st ) = $call( array_merge( $good, array( 'email' => 'test@x.test' ) ) );
ok( 2 === count( $GLOBALS['posts'] ), 'a real lead is kept apart from a test lead with the same email' );

/* Page creation: idempotent, behind the lock */
$reset(); $GLOBALS['opts'] = array( 'admin_email' => 'a@x.test' );
ok( 'created' === franchise_ensure_page(), 'first run creates the page' );
$pg = $GLOBALS['posts'][0];
ok( 'page' === $pg['post_type'] && 'publish' === $pg['post_status'] && 'franchise' === $pg['post_name'] && 'Franchise' === $pg['post_title'] && '[ph_franchise]' === $pg['post_content'] && 0 === $pg['post_parent'], 'page: published, slug franchise, title Franchise, content [ph_franchise], top level' );
ok( 'elementor_header_footer' === $GLOBALS['meta'][1]['_wp_page_template'], 'page template elementor_header_footer' );
ok( 1 === $GLOBALS['opts']['ph_franchise_page'] && ! isset( $GLOBALS['opts']['ph_franchise_page_lock'] ), 'id stored, lock released' );
$o = new \WP_Post(); $o->ID = 1; $o->post_name = 'franchise'; $GLOBALS['pages'][1] = $o;
ok( 'exists' === franchise_ensure_page() && 1 === count( $GLOBALS['posts'] ), 'second run: nothing created' );
$GLOBALS['opts'] = array( 'ph_franchise_page_lock' => (string) time() ); $GLOBALS['pages'] = array();
ok( 'locked' === franchise_ensure_page() && 1 === count( $GLOBALS['posts'] ), 'a held lock: nothing created (another request is creating it)' );
$GLOBALS['opts'] = array( 'ph_franchise_page_lock' => (string) ( time() - 3600 ) );
ok( 'locked' === franchise_ensure_page() && ! isset( $GLOBALS['opts']['ph_franchise_page_lock'] ), 'a stale lock is released for the next request' );
$d = new \WP_Post(); $d->ID = 7; $d->post_name = 'franchise'; $d->post_status = 'draft'; $GLOBALS['pages'] = array( 7 => $d ); $GLOBALS['opts'] = array(); $GLOBALS['updated'] = array();
ok( 'published' === franchise_ensure_page() && 7 === $GLOBALS['opts']['ph_franchise_page'] && 'publish' === $GLOBALS['updated'][0]['post_status'] && 1 === count( $GLOBALS['posts'] ), 'an existing draft with the slug is published, not duplicated' );

/* noindex state and sitemaps */
$GLOBALS['opts'] = array( 'ph_franchise_page' => 7 ); $GLOBALS['meta'][7] = array();
franchise_sync_state();
ok( 'yes' === $GLOBALS['meta'][7]['_seopress_robots_index'] && 'hidden:7' === $GLOBALS['opts']['ph_franchise_state'], 'hidden: SEOPress noindex set on the page' );
$args = franchise_sitemap_args( array( 'post_type' => 'page' ) );
ok( array( 7 ) === $args['post__not_in'], 'hidden: left out of the sitemap queries' );
$GLOBALS['is_page'] = true; $GLOBALS['qo'] = $d;
$r = franchise_robots( array( 'index' => true, 'follow' => true ) );
ok( ! empty( $r['noindex'] ) && ! isset( $r['index'] ), 'hidden: wp_robots noindex on /franchise/' );
$GLOBALS['is_page'] = false;
ok( array( 'index' => true ) === franchise_robots( array( 'index' => true ) ), 'other pages: robots unchanged' );
$GLOBALS['filters']['ph_franchise_live'] = true;
franchise_sync_state();
ok( ! isset( $GLOBALS['meta'][7]['_seopress_robots_index'] ) && 'live:7' === $GLOBALS['opts']['ph_franchise_state'], 'live: SEOPress noindex removed' );
ok( ! isset( franchise_sitemap_args( array() )['post__not_in'] ), 'live: in the sitemaps' );
$GLOBALS['is_page'] = true;
ok( ! isset( franchise_robots( array( 'index' => true ) )['noindex'] ), 'live: indexable' );
unset( $GLOBALS['filters']['ph_franchise_live'] ); $GLOBALS['is_page'] = false;
ok( false === FRANCHISE_LIVE, 'FRANCHISE_LIVE ships false' );

/* Header menu */
$mk = function ( $id, $title, $url, $parent = 0, $cur = false ) { return (object) array( 'ID' => $id, 'db_id' => $id, 'title' => $title, 'url' => $url, 'menu_item_parent' => (string) $parent, 'classes' => $cur ? array( 'menu-item', 'current-menu-item' ) : array( 'menu-item' ), 'current' => $cur, 'menu_order' => 0 ); };
$header = array( $mk( 1, 'Features', '/features/' ), $mk( 2, 'Digital signage', '/digital-signage/', 1 ), $mk( 3, 'Industry', '/industries/' ), $mk( 4, 'Telco', '/industries/telco/', 3 ), $mk( 5, 'Support', '/support-centre/' ), $mk( 6, 'Blog', '/blog/' ) );
$footer = array( $mk( 11, 'Privacy policy', '/privacy-policy/' ), $mk( 12, 'Support', '/support-centre/' ) );
$titles = function ( $items ) { return implode( ',', array_map( function ( $i ) { return $i->title; }, array_filter( $items, function ( $i ) { return '0' === (string) $i->menu_item_parent; } ) ) ); };
ok( $titles( franchise_menu_objects( $header, false, false ) ) === 'Features,Industry,Support,Blog', 'hidden: other pages\' header menu unchanged' );
$on = franchise_menu_objects( array_map( function ( $o ) { return clone $o; }, $header ), true, false );
ok( $titles( $on ) === 'Features,Industry,Franchise,Support,Blog', 'hidden: on /franchise/ the item sits between Industry and Support' );
$fi = array_values( array_filter( $on, function ( $i ) { return 'Franchise' === $i->title; } ) )[0];
ok( 'https://personalisationhub.com/franchise/' === $fi->url && true === $fi->current && in_array( 'current-menu-item', $fi->classes, true ) && '0' === $fi->menu_item_parent, 'item: /franchise/, top level, current-menu-item' );
ok( array( 'aria-current' => 'page' ) === franchise_menu_link_atts( array(), $fi ), 'item: aria-current="page"' );
ok( array() === franchise_menu_link_atts( array(), $header[0] ), 'other items: no aria-current added' );
ok( $titles( franchise_menu_objects( $footer, true, false ) ) === 'Privacy policy,Support', 'footer menu untouched even on /franchise/' );
ok( $titles( franchise_menu_objects( array_map( function ( $o ) { return clone $o; }, $header ), false, true ) ) === 'Features,Industry,Franchise,Support,Blog', 'live: the item shows on every page' );
$live_other = franchise_menu_objects( array_map( function ( $o ) { return clone $o; }, $header ), false, true );
ok( false === array_values( array_filter( $live_other, function ( $i ) { return 'Franchise' === $i->title; } ) )[0]->current, 'live, another page: not marked current' );
$twice = franchise_menu_objects( $on, true, false );
ok( 1 === count( array_filter( $twice, function ( $i ) { return 'Franchise' === $i->title; } ) ), 'never added twice' );

/* The rendered page: copy, order, and no commercial terms */
$html = franchise_html();
$text = html_entity_decode( strip_tags( str_replace( '<', ' <', $html ) ), ENT_QUOTES );
$order = array( 'Be your own boss', 'Why it beats anything out there', 'Your head start in a changing industry', 'Built for people who know media', 'How it works', 'Any business with a physical presence', 'Built to fix retail media\'s fragmentation', 'What could it be worth to you?', 'Give independents a fighting chance', 'See a retail media network run end to end', 'Unlock the product tour' );
$pos = -1; $in_order = true;
foreach ( $order as $s ) { $p2 = strpos( $text, $s ); if ( false === $p2 || $p2 < $pos ) { $in_order = false; fwrite( STDERR, "  order: $s\n" ); } $pos = (int) $p2; }
ok( $in_order, 'the design\'s sections, in order' );
foreach ( array( '$591K', '>90<', '>270<', '2,190,000', '3,942,000', '$59.1M' ) as $s ) { ok( false !== strpos( $html, $s ), "server-rendered default $s" ); }
foreach ( array( '/setup fee/i', '/minimum/i', '/\bsplit\b/i', '/\d+\s*%\s*(of|share)/i', '/50\s*%/', '/0\.5/', '/half/i', '/PH\'s share/i' ) as $re ) { ok( ! preg_match( $re, $text ), "no commercial term on the page: $re" ); }
ok( false !== strpos( $html, 'I agree to be contacted. See the <a href="/privacy-policy/">privacy policy</a>.' ), 'consent line links the privacy policy' );
ok( 5 === substr_count( $html, '<option>' ), 'the 5 backgrounds' );
ok( false !== strpos( $html, 'name="website"' ) && false !== strpos( $html, 'LinkedIn profile (optional)' ), 'honeypot and optional LinkedIn' );
ok( ! preg_match( '/personaliz|organiz/i', $text ), 'UK spelling' );
ok( 7 <= substr_count( $html, 'role="tooltip"' ), 'a tooltip on every input and on How it\'s calculated' );
$c = franchise_calc( franchise_defaults() );
ok( 591300.0 === round( $c['income'], 1 ) && 59130000.0 === round( $c['extraSales'], 1 ), 'franchise_calc defaults' );
ok( '$950' === franchise_money( 950 ) && '$1K' === franchise_money( 1000 ) && '$1.0M' === franchise_money( 1e6 ), 'money format' );

/* Hidden from agents: llms.txt, the twins and the agent endpoint allow-list never name it */
foreach ( array( 'llms.php', 'md.php', 'ld.php', 'ai-surface.php', 'ai-hygiene.php', 'calculators.php' ) as $f ) {
	ok( false === stripos( (string) file_get_contents( $dir . '/' . $f ), 'franchise' ), "$f does not mention the franchise page" );
}
ok( false === stripos( (string) file_get_contents( dirname( __DIR__ ) . '/snippets/ph-agent-endpoint/lib.php' ), 'franchise' ), 'agent endpoint allow-list does not include it' );
$main = (string) file_get_contents( $dir . '/main.php' );
ok( false !== strpos( $main, "require_once __DIR__ . '/franchise.php';" ), 'main.php requires franchise.php' );
$src = (string) file_get_contents( $dir . '/franchise.php' );
ok( false !== strpos( $src, "add_filter( 'wp_robots'" ) && false !== strpos( $src, "header( 'X-Robots-Tag: noindex' )" ) && false !== strpos( $src, "'seopress_sitemaps_single_query'" ) && false !== strpos( $src, "'wp_sitemaps_posts_query_args'" ), 'hooks: wp_robots, X-Robots-Tag, both sitemaps' );
ok( false !== strpos( $src, "if ( ! franchise_is_page() ) {\n\t\t\treturn;\n\t\t}\n\t\t\$ver = PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063;" ), 'franchise.css and franchise.js load only on the page, with the assets version' );

if ( $fails ) {
	fwrite( STDERR, "franchise.test.php: $fails of $count checks failed\n" );
	exit( 1 );
}
echo "franchise.test.php: $count checks passed\n";
}
