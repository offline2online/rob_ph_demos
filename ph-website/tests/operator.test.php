<?php
/**
 * php ph-website/tests/operator.test.php : the hidden Run Your Own RMN page, /run-your-own-rmn/ (snippet 10063, operator.php).
 * POST ph-site/v1/operator-lead validation (400 with the field), optional and normalised LinkedIn, the background allow-list, honeypot,
 * 429, personal email accepted, one lead per person in both orders, the ph_lead_captured payload and the console ingest body (leadType,
 * source detail "Run Your Own RMN page – product tour"), the test flag and no admin mail in test; the move of page 10776 onto
 * run-your-own-rmn (once, idempotent, behind its own lock apart from the 1.9.21 one; title "Run Your Own RMN", [ph_operator], every
 * _wp_old_slug removed so the earlier slugs 404, only page 10776 and only while it holds a [ph_ shortcode, never a second page); no
 * redirect from the earlier URLs; idempotent page creation behind the lock; the header menu item "Run Your Own RMN" (only on the page
 * while hidden, everywhere when live); noindex and no sitemap while hidden; the document title, meta description (155 characters or
 * fewer, ending on a full word), canonical, Open Graph, Twitter card and JSON-LD (valid; WebPage, Service, BreadcrumbList, FAQPage
 * equal to the visible FAQ); exactly one H1; the FAQ; llms.txt, the markdown twin, the agent endpoint and robots.txt naming the page
 * only when live. Labels say "Network operator inquiry"; the console key leadType is "operator". The retired offer name is checked
 * for with the pattern fr[a]nch, and the page's previous name with a bracketed pattern, so that this file itself never contains them.
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
function wp_unslash( $v ) { return $v; } function sanitize_text_field( $v ) { return trim( strip_tags( (string) $v ) ); }
function sanitize_email( $v ) { return trim( (string) $v ); } function is_email( $v ) { return (bool) filter_var( $v, FILTER_VALIDATE_EMAIL ); }
function get_transient( $k ) { return $GLOBALS['tr'][ $k ] ?? false; } function set_transient( $k, $v ) { $GLOBALS['tr'][ $k ] = $v; }
function wp_insert_post( $a ) { $GLOBALS['posts'][] = $a; $id = count( $GLOBALS['posts'] ); if ( ! empty( $a['meta_input'] ) ) { foreach ( $a['meta_input'] as $k => $v ) { $GLOBALS['meta'][ $id ][ $k ] = $v; } } return $id; }
function wp_update_post( $a ) { $GLOBALS['updated'][] = $a; if ( isset( $GLOBALS['pages'][ $a['ID'] ] ) ) { $pg = $GLOBALS['pages'][ $a['ID'] ]; if ( isset( $a['post_name'] ) && $a['post_name'] !== $pg->post_name && empty( $GLOBALS['update_fails'] ) ) { $GLOBALS['meta'][ $a['ID'] ]['_wp_old_slug'] = $pg->post_name; } /* as wp_check_for_changed_slugs does */ foreach ( array( 'post_name', 'post_title', 'post_status', 'post_content', 'post_parent' ) as $k ) { if ( isset( $a[ $k ] ) ) { $pg->$k = $a[ $k ]; } } } return $GLOBALS['update_fails'] ?? false ? 0 : $a['ID']; }
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
class WP_Post { public $ID; public $post_name; public $post_title = ''; public $post_content = ''; public $post_parent = 0; public $post_type = 'page'; public $post_status = 'publish'; }
$GLOBALS['is_page'] = false; $GLOBALS['qo'] = null;
function is_page() { return $GLOBALS['is_page']; } function get_queried_object() { return $GLOBALS['qo']; }

function is_admin() { return false; } function wp_doing_ajax() { return false; } function wp_doing_cron() { return false; }
require $dir . '/leads.php';
require $dir . '/operator.php';
require $dir . '/redirects.php';
require $dir . '/ai-surface.php';
}

namespace AngieSnippets\PhIndustryEnhancements_10063 {
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
ok( 5 === count( OPERATOR_BACKGROUNDS ), 'exactly five backgrounds' );
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
ok( false !== strpos( $GLOBALS['mails'][0][2], 'Page: /run-your-own-rmn/' ) && ! preg_match( '/fr[a]nch/i', $GLOBALS['mails'][0][1] . $GLOBALS['mails'][0][2] ), 'admin email names the new page and never the retired offer name' );

/* Ingest body */
$body = lead_ingest_body( $p );
foreach ( array( 'company' => 'Ada Lovelace', 'industry' => 'Network operator inquiry', 'countries' => 'Manchester and the North West', 'contactName' => 'Ada Lovelace', 'jobTitle' => 'Retail media', 'email' => 'ada@gmail.com', 'linkedin' => 'https://linkedin.com/in/ada', 'page' => '/run-your-own-rmn/', 'pageIndustry' => 'operator', 'sourceLabel' => 'Network operator inquiry', 'sourceDetail' => 'Run Your Own RMN page – product tour', 'leadType' => 'operator', 'region' => 'Manchester and the North West', 'background' => 'Retail media' ) as $k => $v ) {
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
ok( 200 === $st && 1 === count( $GLOBALS['posts'] ), 'industry tour then operator inquiry: no second lead' );
$acts = $GLOBALS['meta'][1]['ph_lead_activity'];
ok( 2 === count( $acts ) && 'Network operator inquiry' === $acts[1]['label'], 'industry tour then operator inquiry: an activity row "Network operator inquiry" is added' );
ok( 'interactive-product-tour' === $GLOBALS['meta'][1]['ph_lead_source'] && 'Orbit' === $GLOBALS['meta'][1]['ph_lead_company'] && 'Retail media' === $GLOBALS['meta'][1]['ph_lead_background'], 'the existing lead keeps its source and company and gains the network operator fields' );
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

/* Page creation: idempotent, behind the lock (a site without the page) */
$reset(); $GLOBALS['opts'] = array( 'admin_email' => 'a@x.test' ); $GLOBALS['pages'] = array(); $GLOBALS['updated'] = array();
ok( 'created' === operator_ensure_page(), 'first run creates the page' );
$pg = $GLOBALS['posts'][0];
ok( 'page' === $pg['post_type'] && 'publish' === $pg['post_status'] && 'run-your-own-rmn' === $pg['post_name'] && 'Run Your Own RMN' === $pg['post_title'] && '[ph_operator]' === $pg['post_content'] && 0 === $pg['post_parent'], 'page: published, slug run-your-own-rmn, title Run Your Own RMN, content [ph_operator], top level' );
ok( 'elementor_header_footer' === $GLOBALS['meta'][1]['_wp_page_template'], 'page template elementor_header_footer' );
ok( 1 === $GLOBALS['opts']['ph_operator_page'] && ! isset( $GLOBALS['opts']['ph_operator_page_lock'] ), 'id stored, lock released' );
$o = new \WP_Post(); $o->ID = 1; $o->post_name = 'run-your-own-rmn'; $o->post_title = 'Run Your Own RMN'; $GLOBALS['pages'][1] = $o;
ok( 'exists' === operator_ensure_page() && 1 === count( $GLOBALS['posts'] ) && ! $GLOBALS['updated'], 'second run: nothing created or updated' );
$GLOBALS['opts'] = array( 'ph_operator_page_lock' => (string) time() ); $GLOBALS['pages'] = array();
ok( 'locked' === operator_ensure_page() && 1 === count( $GLOBALS['posts'] ), 'a held lock: nothing created (another request is creating it)' );
$GLOBALS['opts'] = array( 'ph_operator_page_lock' => (string) ( time() - 3600 ) );
ok( 'locked' === operator_ensure_page() && ! isset( $GLOBALS['opts']['ph_operator_page_lock'] ), 'a stale lock is released for the next request' );
$d = new \WP_Post(); $d->ID = 7; $d->post_name = 'run-your-own-rmn'; $d->post_status = 'draft'; $GLOBALS['pages'] = array( 7 => $d ); $GLOBALS['opts'] = array(); $GLOBALS['updated'] = array();
ok( 'migrated' === operator_ensure_page() && 7 === $GLOBALS['opts']['ph_operator_page'] && 'publish' === $GLOBALS['updated'][0]['post_status'] && 'publish' === $d->post_status && 1 === count( $GLOBALS['posts'] ), 'an existing draft with the slug is published, not duplicated' );

/* The migration: page 10776 (the existing hidden page) is found BY ID and updated in place, once, idempotently, behind the lock */
$reset(); $GLOBALS['updated'] = array();
$retired = 'retired-slug'; // stands in for the page's earlier slug, which this file never spells out
$mkold = function () use ( $retired ) { $p = new \WP_Post(); $p->ID = 10776; $p->post_name = $retired; $p->post_title = 'Old title'; $p->post_content = '[ph_old_shortcode]'; return $p; };
$live = $mkold();
$GLOBALS['pages'] = array( 10776 => $live ); $GLOBALS['opts'] = array(); $GLOBALS['meta'][10776] = array( '_wp_old_slug' => 'an-older-slug', '_wp_page_template' => 'elementor_header_footer' );
ok( 10776 === OPERATOR_PAGE_ID, 'OPERATOR_PAGE_ID is 10776' );
$GLOBALS['opts']['ph_operator_rmn_move_lock'] = (string) time();
ok( 'locked' === operator_ensure_page() && ! $GLOBALS['updated'] && $retired === $live->post_name, 'migration: a held move lock means another request is moving it; nothing done here' );
unset( $GLOBALS['opts']['ph_operator_rmn_move_lock'] );
ok( 'migrated' === operator_ensure_page(), 'migration: page 10776 found by id (no stored option, not on the new slug) and migrated' );
ok( 1 === count( $GLOBALS['updated'] ) && 10776 === $GLOBALS['updated'][0]['ID'] && 'run-your-own-rmn' === $GLOBALS['updated'][0]['post_name'] && 'Run Your Own RMN' === $GLOBALS['updated'][0]['post_title'] && '[ph_operator]' === $GLOBALS['updated'][0]['post_content'], 'migration: one wp_update_post of page 10776: slug, title and content [ph_operator]' );
ok( ! $GLOBALS['posts'], 'migration: no second page is created' );
ok( 'run-your-own-rmn' === $live->post_name && 'Run Your Own RMN' === $live->post_title && '[ph_operator]' === $live->post_content && 'publish' === $live->post_status, 'migration: page 10776 is now /run-your-own-rmn/ "Run Your Own RMN" with [ph_operator], published' );
ok( ! isset( $GLOBALS['meta'][10776]['_wp_old_slug'] ) && 'elementor_header_footer' === $GLOBALS['meta'][10776]['_wp_page_template'], 'migration: its _wp_old_slug meta is deleted (the earlier slugs and the one the move itself recorded), other meta kept' );
ok( null === get_page_by_path( $retired ), 'migration: nothing left on the earlier slug' );
ok( 10776 === $GLOBALS['opts']['ph_operator_page'] && ! isset( $GLOBALS['opts']['ph_operator_rmn_move_lock'] ), 'migration: id stored in ph_operator_page, move lock released' );
for ( $i = 0; $i < 3; $i++ ) { ok( 'exists' === operator_ensure_page(), 'migration: later runs do nothing (' . ( $i + 1 ) . ')' ); }
ok( 1 === count( $GLOBALS['updated'] ) && ! $GLOBALS['posts'], 'migration: done once (idempotent)' );
// A stored option pointing at 10776 still on the earlier slug (an interrupted run): migrated, never duplicated.
$o2 = $mkold(); $GLOBALS['pages'] = array( 10776 => $o2 ); $GLOBALS['opts'] = array( 'ph_operator_page' => 10776 ); $GLOBALS['updated'] = array();
ok( 'migrated' === operator_ensure_page() && 'run-your-own-rmn' === $o2->post_name && ! $GLOBALS['posts'], 'an interrupted migration finishes on the next request' );
// 10776 missing: the page is created as before (and only once).
$GLOBALS['pages'] = array(); $GLOBALS['opts'] = array(); $GLOBALS['updated'] = array(); $GLOBALS['posts'] = array(); $GLOBALS['meta'] = array();
ok( 'created' === operator_ensure_page() && 1 === count( $GLOBALS['posts'] ) && '[ph_operator]' === $GLOBALS['posts'][0]['post_content'] && ! $GLOBALS['updated'], '10776 missing: the page is created' );
$GLOBALS['pages'][1] = new \WP_Post(); $GLOBALS['pages'][1]->ID = 1; $GLOBALS['pages'][1]->post_name = 'run-your-own-rmn';
ok( 'exists' === operator_ensure_page() && 1 === count( $GLOBALS['posts'] ), '10776 missing: never a second page' );
// 10776 being some unrelated page (not one of our shortcode pages) is never touched.
$other = new \WP_Post(); $other->ID = 10776; $other->post_name = 'about-us'; $other->post_content = '<p>About us</p>';
$GLOBALS['pages'] = array( 10776 => $other ); $GLOBALS['opts'] = array(); $GLOBALS['updated'] = array(); $GLOBALS['posts'] = array();
ok( 'created' === operator_ensure_page() && 'about-us' === $other->post_name && ! $GLOBALS['updated'], 'an unrelated page 10776 is never migrated' );
// A child page on the new slug elsewhere is never taken.
$ch = new \WP_Post(); $ch->ID = 55; $ch->post_name = 'run-your-own-rmn'; $ch->post_parent = 9; $GLOBALS['pages'] = array( 55 => $ch ); $GLOBALS['opts'] = array(); $GLOBALS['updated'] = array(); $GLOBALS['posts'] = array();
ok( 'created' === operator_ensure_page() && 9 === $ch->post_parent && ! $GLOBALS['updated'], 'a child page with the slug is not taken' );
// WordPress refusing the update: nothing stored, lock released, the next request retries.
$o3 = $mkold(); $GLOBALS['pages'] = array( 10776 => $o3 ); $GLOBALS['opts'] = array(); $GLOBALS['update_fails'] = true;
ok( 'failed' === operator_ensure_page() && ! isset( $GLOBALS['opts']['ph_operator_rmn_move_lock'] ) && ! isset( $GLOBALS['opts']['ph_operator_page'] ), 'a refused update releases the move lock to retry' );
unset( $GLOBALS['update_fails'] ); $reset();

/* No redirect from the page's earlier URL: it was never public, so it is a 404 */
ok( array( '/retail-media-platform' ) === array_keys( redirect_map() ), 'redirects.php: only the retail media platform move is mapped' );
ok( ! in_array( '/run-your-own-rmn/', redirect_map(), true ) && '' === redirect_target( '/run-your-own-rmn/' ), 'nothing redirects to or from /run-your-own-rmn/' );
ok( ! preg_match( '/fr[a]nch/i', (string) file_get_contents( $dir . '/redirects.php' ) ), 'redirects.php never names the retired offer' );

/* noindex state and sitemaps */
$d = new \WP_Post(); $d->ID = 7; $d->post_name = 'run-your-own-rmn';
$GLOBALS['opts'] = array( 'ph_operator_page' => 7 ); $GLOBALS['meta'][7] = array();
operator_sync_state();
ok( 'yes' === $GLOBALS['meta'][7]['_seopress_robots_index'] && 'hidden:7' === $GLOBALS['opts']['ph_operator_state'], 'hidden: SEOPress noindex set on the page' );
$args = operator_sitemap_args( array( 'post_type' => 'page' ) );
ok( array( 7 ) === $args['post__not_in'], 'hidden: left out of the sitemap queries' );
$GLOBALS['is_page'] = true; $GLOBALS['qo'] = $d;
$r = operator_robots( array( 'index' => true, 'follow' => true ) );
ok( ! empty( $r['noindex'] ) && ! isset( $r['index'] ), 'hidden: wp_robots noindex on /run-your-own-rmn/' );
ok( 'Run Your Own Retail Media Network (RMN) - Personalisation Hub' === operator_document_title( 'Old - Personalisation Hub' ), 'document title "Run Your Own Retail Media Network (RMN) - Personalisation Hub" on the page' );
$GLOBALS['qo'] = $live;
$r = operator_robots( array( 'index' => true ) );
ok( ! empty( $r['noindex'] ), 'hidden: noindex keyed to the migrated page 10776' );
$old = new \WP_Post(); $old->ID = 99; $old->post_name = $retired; $GLOBALS['qo'] = $old;
ok( ! isset( operator_robots( array( 'index' => true ) )['noindex'] ) && 'T' === operator_document_title( 'T' ), 'the earlier slug is no longer the page' );
$GLOBALS['qo'] = $d;
$GLOBALS['is_page'] = false;
ok( array( 'index' => true ) === operator_robots( array( 'index' => true ) ), 'other pages: robots unchanged' );
ok( 'Home | X' === operator_document_title( 'Home | X' ), 'other pages: title unchanged' );
$GLOBALS['filters']['ph_operator_live'] = true;
operator_sync_state();
ok( ! isset( $GLOBALS['meta'][7]['_seopress_robots_index'] ) && 'live:7' === $GLOBALS['opts']['ph_operator_state'], 'live: SEOPress noindex removed' );
ok( ! isset( operator_sitemap_args( array() )['post__not_in'] ), 'live: in the sitemaps' );
$GLOBALS['is_page'] = true;
ok( ! isset( operator_robots( array( 'index' => true ) )['noindex'] ), 'live: indexable' );
unset( $GLOBALS['filters']['ph_operator_live'] ); $GLOBALS['is_page'] = false;
ok( false === OPERATOR_LIVE, 'OPERATOR_LIVE ships false' );

/* Header menu */
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

/* The rendered page: copy, order, and no commercial terms */
$html = operator_html();
$text = html_entity_decode( strip_tags( str_replace( '<', ' <', $html ) ), ENT_QUOTES );
$order = array( 'Run your own retail media network', 'Your own RMN on a world-leading white-label platform', 'Why it beats anything out there', 'Your head start in a changing industry', 'Built for people who know media', 'How it works', 'Any business with a physical presence', 'Built to fix retail media\'s fragmentation', 'What could it be worth to you?', 'Give independents a fighting chance', 'Running your own RMN', 'What is a retail media network?', 'How do I get started?', 'See a retail media network run end to end', 'Unlock the product tour' );
$pos = -1; $in_order = true;
foreach ( $order as $s ) { $p2 = strpos( $text, $s ); if ( false === $p2 || $p2 < $pos ) { $in_order = false; fwrite( STDERR, "  order: $s\n" ); } $pos = (int) $p2; }
ok( $in_order, 'the design\'s sections, in order' );
foreach ( array( '$591K', '>90<', '>270<', '2,190,000', '3,942,000', '$59.1M' ) as $s ) { ok( false !== strpos( $html, $s ), "server-rendered default $s" ); }
foreach ( array( '/setup fee/i', '/minimum/i', '/\bsplit\b/i', '/\d+\s*%\s*(of|share)/i', '/50\s*%/', '/0\.5/', '/half/i', '/PH\'s share/i' ) as $re ) { ok( ! preg_match( $re, $text ), "no commercial term on the page: $re" ); }
ok( false !== strpos( $html, 'I agree to be contacted. See the <a href="/privacy-policy/">privacy policy</a>.' ), 'consent line links the privacy policy' );
ok( 5 === substr_count( $html, '<option>' ), 'the 5 backgrounds' );
ok( false !== strpos( $html, 'name="website"' ) && false !== strpos( $html, 'LinkedIn profile (optional)' ), 'honeypot and optional LinkedIn' );
ok( ! preg_match( '/personaliz|organiz/i', $text ), 'UK spelling' );
ok( ! preg_match( '/fr[a]nch/i', $html ), 'the rendered page (text and every attribute) never names the retired offer' );
foreach ( array( 'If you have relationships with brands, retailers or businesses with a physical presence, becoming a Personalisation Hub network operator gives you a head start: your own retail media network, ready to sell from day one.', '<p class="phf-cin-h">Your network</p>', 'Tell us a little about yourself to watch the full walkthrough. Our team will also follow up with more on becoming a network operator.' ) as $s ) {
	ok( false !== strpos( html_entity_decode( $html, ENT_QUOTES ), $s ), 'exact copy: ' . substr( $s, 0, 70 ) );
}
ok( 7 <= substr_count( $html, 'role="tooltip"' ), 'a tooltip on every input and on How it\'s calculated' );
$c = operator_calc( operator_defaults() );
ok( 591300.0 === round( $c['income'], 1 ) && 59130000.0 === round( $c['extraSales'], 1 ), 'operator_calc defaults' );
ok( '$950' === operator_money( 950 ) && '$1K' === operator_money( 1000 ) && '$1.0M' === operator_money( 1e6 ), 'money format' );

/* The static agent files never name the page: only operator.php adds it, and only once live (below) */
foreach ( array( 'llms.php', 'md.php', 'ld.php', 'ai-surface.php', 'ai-hygiene.php', 'calculators.php' ) as $f ) {
	$fs = (string) file_get_contents( $dir . '/' . $f );
	ok( ! preg_match( '/fr[a]nch/i', $fs ) && false === stripos( $fs, 'run-your-own-rmn' ), "$f does not mention the page" );
}
$al = (string) file_get_contents( dirname( __DIR__ ) . '/snippets/ph-agent-endpoint/lib.php' );
ok( ! preg_match( '/fr[a]nch/i', $al ) && false === stripos( $al, 'run-your-own-rmn' ), 'agent endpoint allow-list does not include it (it is added through ph_agent_extra_pages, only when live)' );

/* The rename (14 Nov 2026): from the 1.9.21 state, page 10776 moves once onto run-your-own-rmn behind its OWN lock */
$reset(); $GLOBALS['updated'] = array();
$prev = 'previous-slug'; // stands in for the 1.9.21 slug, which this file never spells out
$p21  = new \WP_Post(); $p21->ID = 10776; $p21->post_name = $prev; $p21->post_title = 'Previous title'; $p21->post_content = '[ph_operator]';
$GLOBALS['pages'] = array( 10776 => $p21 );
$GLOBALS['opts']  = array( 'ph_operator_page' => 10776, 'ph_operator_state' => 'hidden:10776', 'ph_operator_page_lock' => (string) time() ); // the 1.9.21 lock, still held
$GLOBALS['meta'][10776] = array( '_wp_old_slug' => 'the-slug-before-that', '_wp_page_template' => 'elementor_header_footer' );
ok( 'ph_operator_rmn_move_lock' === OPERATOR_MOVE_LOCK && OPERATOR_MOVE_LOCK !== OPERATOR_LOCK_OPTION, 'the move has its own lock option, apart from the 1.9.21 one' );
ok( 'migrated' === operator_ensure_page(), 'rename: the 1.9.21 page is moved even while the 1.9.21 lock is held' );
ok( 1 === count( $GLOBALS['updated'] ) && 10776 === $GLOBALS['updated'][0]['ID'] && 'run-your-own-rmn' === $p21->post_name && 'Run Your Own RMN' === $p21->post_title && '[ph_operator]' === $p21->post_content && 'publish' === $p21->post_status, 'rename: page 10776 is now /run-your-own-rmn/ "Run Your Own RMN" with [ph_operator], published' );
ok( ! isset( $GLOBALS['meta'][10776]['_wp_old_slug'] ), 'rename: no _wp_old_slug left (neither the 1.9.21 slug nor the one before it), so both earlier URLs answer 404' );
ok( ! $GLOBALS['posts'] && null === get_page_by_path( $prev ), 'rename: no second page, nothing left on the 1.9.21 slug' );
ok( ! isset( $GLOBALS['opts']['ph_operator_rmn_move_lock'] ) && 10776 === $GLOBALS['opts']['ph_operator_page'], 'rename: move lock released, id kept' );
for ( $i = 0; $i < 3; $i++ ) { operator_ensure_page(); }
ok( 1 === count( $GLOBALS['updated'] ) && ! $GLOBALS['posts'] && 'exists' === operator_ensure_page(), 'rename: idempotent (one update, however many requests)' );
ok( false === array_search( '/' . $prev . '/', redirect_map(), true ) && '' === redirect_target( '/' . $prev . '/' ), 'rename: the 1.9.21 URL is not redirected (never public: a 404)' );
// Only page 10776 and only while it holds a [ph_ shortcode: a stored id pointing at an unrelated page is never moved.
$x = new \WP_Post(); $x->ID = 321; $x->post_name = 'contact'; $x->post_content = '<p>Contact us</p>';
$GLOBALS['pages'] = array( 321 => $x ); $GLOBALS['opts'] = array( 'ph_operator_page' => 321 ); $GLOBALS['updated'] = array(); $GLOBALS['posts'] = array();
ok( 'created' === operator_ensure_page() && 'contact' === $x->post_name && ! $GLOBALS['updated'], 'rename: a stored id naming a page without our shortcode is never moved' );
$reset(); $GLOBALS['opts'] = array( 'admin_email' => 'a@x.test' ); $GLOBALS['pages'] = array(); $GLOBALS['updated'] = array();

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
foreach ( array( 'WebPage', 'Service', 'BreadcrumbList', 'FAQPage' ) as $t ) { ok( isset( $byType[ $t ] ), "JSON-LD has a $t" ); }
$wp = $byType['WebPage'];
ok( 'en-GB' === $wp['inLanguage'] && in_array( $wp['isPartOf']['@id'], $ids, true ) && 'WebSite' === $byType['WebSite']['@type'] && 'https://personalisationhub.com/#website' === $wp['isPartOf']['@id'] && 'Retail media network' === $wp['about']['name'], 'WebPage: en-GB, isPartOf the WebSite, about "Retail media network"' );
$sv = $byType['Service'];
ok( 'Run your own retail media network' === $sv['name'] && 'White-label retail media network platform' === $sv['serviceType'] && 'https://personalisationhub.com/#organization' === $sv['provider']['@id'] && in_array( $sv['provider']['@id'], $ids, true ), 'Service: name, serviceType, provider = the Organization' );
ok( false === strpos( json_encode( $ld ), 'areaServed' ), 'no areaServed anywhere (the business is global)' );
$bl = $byType['BreadcrumbList']['itemListElement'];
ok( 2 === count( $bl ) && 'Home' === $bl[0]['name'] && 'https://personalisationhub.com/' === $bl[0]['item'] && 'Run Your Own RMN' === $bl[1]['name'] && 'https://personalisationhub.com/run-your-own-rmn/' === $bl[1]['item'], 'BreadcrumbList: Home › Run Your Own RMN' );
// FAQPage equals the visible FAQ, word for word.
$dom = new \DOMDocument(); @$dom->loadHTML( '<?xml encoding="utf-8"?>' . operator_html() ); $px = new \DOMXPath( $dom );
$visible = array();
foreach ( $px->query( '//section[@id="faq"]//details' ) as $det ) {
	$visible[] = array( trim( $px->query( './/summary', $det )->item( 0 )->textContent ), trim( $px->query( './/div[contains(@class,"phf-faq-a")]', $det )->item( 0 )->textContent ) );
}
$ldq = array_map( function ( $q ) { return array( $q['name'], $q['acceptedAnswer']['text'] ); }, $byType['FAQPage']['mainEntity'] );
ok( count( $visible ) >= 5 && count( $visible ) <= 6 && $visible === $ldq, 'FAQPage equals the visible FAQ (' . count( $visible ) . ' questions)' );
ok( 1 === $px->query( '//h1' )->length && 'Run your own retail media network' === trim( $px->query( '//h1' )->item( 0 )->textContent ), 'exactly one H1: "Run your own retail media network"' );
ok( 'Your own RMN on a world-leading white-label platform' === trim( $px->query( '//*[contains(@class,"phf-hero-sub")]' )->item( 0 )->textContent ), 'hero sub-line' );
ok( 'Running your own RMN' === trim( $px->query( '//section[@id="faq"]//h2' )->item( 0 )->textContent ), 'FAQ titled "Running your own RMN"' );
ok( strpos( $html, 'id="faq"' ) < strpos( $html, 'id="tour"' ) && strpos( $html, 'id="independents"' ) < strpos( $html, 'id="faq"' ), 'the FAQ sits before the closing tour band' );
$faqText = implode( ' ', array_merge( ...$visible ) );
ok( ! preg_match( '/\d/', str_replace( '1,000', '', $faqText ) ), 'FAQ: no figures beyond the page\'s own "1,000"' );
foreach ( array( '/0\.5/', '/50\s*%/', '/\bhalf\b/i', '/personaliz|organiz/i', '/fr[a]nch/i', '/\b(UK|Britain|British|America|Australia)\b/' ) as $re ) { ok( ! preg_match( $re, $faqText ), "FAQ: nothing matching $re" ); }
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
$GLOBALS['opts']['ph_operator_page'] = 10776;
ok( null === operator_agent_page( false ), 'hidden: the agent endpoint gets nothing' );
$ap = operator_agent_page( true );
ok( is_array( $ap ) && 'https://personalisationhub.com/run-your-own-rmn/' === $ap['url'] && 'Run your own retail media network (RMN)' === $ap['title'] && $ap['md'] === operator_twin(), 'live: the agent endpoint gets the page and its twin' );
unset( $GLOBALS['opts']['ph_operator_page'] );
ok( null === operator_agent_page( true ), 'live but no page: nothing' );
ok( array() === operator_robots_allow( array(), false ) && array( '/run-your-own-rmn/' ) === operator_robots_allow( array(), true ), 'robots.txt allow list: the page only when live' );
$wp_robots = "User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n";
ok( false === strpos( robots_txt_text( $wp_robots, true, operator_robots_allow( array(), false ) ), 'run-your-own-rmn' ) && false !== strpos( robots_txt_text( $wp_robots, true, operator_robots_allow( array(), true ) ), "Allow: /\nAllow: /run-your-own-rmn/\n" ), 'robots.txt: "Allow: /run-your-own-rmn/" in the AI agents\' group only when live' );
$tw = operator_twin();
ok( 0 === strpos( $tw, "# Run your own retail media network\n\n> " . OPERATOR_META_DESC . "\n\nSource: https://personalisationhub.com/run-your-own-rmn/" ), 'twin: H1, summary and source' );
foreach ( array( '## Key facts', '**Your brand, your own AWS account:**', '## How it works', '## Benefits calculator', '- Venues (90): ', '- Your potential income a year: $591K', '- Ad views a month: 3,942,000', '- Extra sales for your venues a year: $59.1M', OPERATOR_HOW_CALC, 'estimate_rmn_earnings', '## FAQ', '## Interactive product tour', 'https://personalisationhub.com/run-your-own-rmn/#tour' ) as $want ) {
	ok( false !== strpos( $tw, $want ), 'twin has: ' . substr( $want, 0, 60 ) );
}
foreach ( operator_faq() as $qa ) { ok( false !== strpos( $tw, '### ' . $qa[0] . "\n\n" . $qa[1] ), 'twin FAQ: ' . $qa[0] ); }
foreach ( array( '/0\.5/', '/50\s*%/', '/\bhalf\b/i', '/fr[a]nch/i', '/personaliz/i' ) as $re ) { ok( ! preg_match( $re, $tw ), "twin: nothing matching $re (no share constant)" ); }
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
ok( 'operator' === OPERATOR_SOURCE && 'ph_operator' === OPERATOR_SHORTCODE && 'ph_operator_page' === OPERATOR_PAGE_OPTION && 'ph_operator_page_lock' === OPERATOR_LOCK_OPTION && 'ph_operator_state' === OPERATOR_STATE_OPTION, 'console key "operator", shortcode [ph_operator], options ph_operator_page / _lock / _state' );
ok( false !== strpos( $src, "apply_filters( 'ph_operator_live', OPERATOR_LIVE )" ) && false !== strpos( $src, "'ph-operator-10063'" ) && false !== strpos( $src, "'window.PH_OPERATOR = '" ) && false !== strpos( $src, "'endpoint' => '/wp-json/ph-site/v1/operator-lead'" ), 'filter ph_operator_live, handles ph-operator-10063, window.PH_OPERATOR, endpoint operator-lead' );
foreach ( array( 'operator.php', 'operator-content.php', 'operator.css', 'operator.js', 'main.php', 'leads.php', 'redirects.php', 'enhance.js' ) as $f ) {
	ok( ! preg_match( '/fr[a]nch/i', (string) file_get_contents( $dir . '/' . $f ) ), "$f never names the retired offer (code or comments)" );
}
foreach ( array( 'operator.php', 'operator-content.php', 'operator.css', 'operator.js' ) as $f ) { ok( is_file( $dir . '/' . $f ), "snippet file $f exists" ); }
ok( ! glob( $dir . '/fr[a]nch*' ), 'no snippet file is named after the retired offer' );
ok( false !== strpos( $src, "register_rest_route( 'ph-site/v1', '/operator-lead'" ), 'REST route ph-site/v1/operator-lead' );
ok( false !== strpos( $src, "add_filter( 'wp_robots'" ) && false !== strpos( $src, "header( 'X-Robots-Tag: noindex' )" ) && false !== strpos( $src, "'seopress_sitemaps_single_query'" ) && false !== strpos( $src, "'wp_sitemaps_posts_query_args'" ), 'hooks: wp_robots, X-Robots-Tag, both sitemaps' );
ok( false !== strpos( $src, "if ( ! operator_is_page() ) {\n\t\t\treturn;\n\t\t}\n\t\t\$ver = PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063;" ), 'operator.css and operator.js load only on the page, with the assets version' );

if ( $fails ) {
	fwrite( STDERR, "operator.test.php: $fails of $count checks failed\n" );
	exit( 1 );
}
echo "operator.test.php: $count checks passed\n";
}
