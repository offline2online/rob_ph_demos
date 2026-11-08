<?php
/**
 * php ph-website/tests/pharmacy-model.test.php : the pharmacy model (parity with enhance.js pharmCalc), the workbook, and the
 * lead gate / signed download (pharmacy-lead.php). The download handler exits, so the streamed-file case runs in a child process.
 */
namespace AngieSnippets\PhIndustryEnhancements_10063 {
	function header( $h ) { $GLOBALS['hdr'][] = $h; }
}
namespace {
error_reporting( E_ALL );
define( 'ABSPATH', '/' );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'DAY_IN_SECONDS', 86400 );
$fails = 0;
function ok( $c, $m ) { global $fails; if ( ! $c ) { $fails++; fwrite( STDERR, "FAIL: $m\n" ); } }
$dir = dirname( __DIR__ ) . '/snippets/ph-industry-enhancements';

$GLOBALS['opts'] = array( 'admin_email' => 'a@x.test' ); $GLOBALS['tr'] = array(); $GLOBALS['posts'] = array(); $GLOBALS['meta'] = array(); $GLOBALS['fired'] = array(); $GLOBALS['mails'] = array(); $GLOBALS['routes'] = array(); $GLOBALS['hdr'] = array();
function add_action( $n, $cb ) { if ( 'rest_api_init' === $n ) { $GLOBALS['rest'][] = $cb; } }
function add_filter() {} function register_post_type() {} function current_user_can() { return false; }
function wp_unslash( $v ) { return $v; } function sanitize_text_field( $v ) { return trim( strip_tags( (string) $v ) ); }
function sanitize_email( $v ) { return trim( (string) $v ); } function is_email( $v ) { return (bool) filter_var( $v, FILTER_VALIDATE_EMAIL ); }
function get_transient( $k ) { return $GLOBALS['tr'][ $k ] ?? false; } function set_transient( $k, $v ) { $GLOBALS['tr'][ $k ] = $v; }
function wp_insert_post( $a ) { $GLOBALS['posts'][] = $a; return count( $GLOBALS['posts'] ); } function is_wp_error() { return false; }
function update_post_meta( $id, $k, $v ) { $GLOBALS['meta'][ $id ][ $k ] = $v; }
function get_post_meta( $id, $k, $single = false ) { return $GLOBALS['meta'][ $id ][ $k ] ?? ''; }
class WP_Query { public $posts = array(); function __construct( $a ) { $email = $a['meta_query'][0]['value']; $test = isset( $a['meta_query'][1]['value'] );
	foreach ( $GLOBALS['meta'] as $id => $m ) { if ( ( $m['ph_lead_email'] ?? '' ) === $email && ( '1' === ( $m['ph_lead_test'] ?? '' ) ) === $test ) { $this->posts[] = $id; break; } } } }
function do_action( $n, $p = null ) { $GLOBALS['fired'][] = array( $n, $p ); }
function wp_mail( $to, $s, $b ) { $GLOBALS['mails'][] = array( $to, $s, $b ); }
function get_option( $k, $d = false ) { return $GLOBALS['opts'][ $k ] ?? $d; }
function wp_json_encode( $v ) { return json_encode( $v ); }
function wp_salt() { return 'test-salt'; }
function rest_url( $p = '' ) { return 'https://personalisationhub.com/wp-json/' . $p; }
function add_query_arg( $a, $u ) { return $u . '?' . http_build_query( $a ); }
function nocache_headers() {}
function esc_url_raw( $u ) { return $u; }
function register_rest_route( $ns, $r, $a ) { $GLOBALS['routes'][ $ns . $r ] = $a; }
class WP_REST_Response { public $data; public $status; function __construct( $d, $s ) { $this->data = $d; $this->status = $s; } }
class WP_REST_Request { private $b; private $q; function __construct( $b, $q = array() ) { $this->b = $b; $this->q = $q; } function get_json_params() { return $this->b; } function get_query_params() { return $this->q; } function get_param( $k ) { return $this->q[ $k ] ?? null; } }

require $dir . '/leads.php';
require $dir . '/telco-lead.php';
require $dir . '/pharmacy-lead.php';
use function AngieSnippets\PhIndustryEnhancements_10063\{pharm_spec,pharm_clean,pharm_calc,pharm_xlsx,pharm_sign,telco_clean,telco_xlsx};

if ( isset( $argv[1] ) && 'download' === $argv[1] ) { // child: stream the file for a signed link and report.
	foreach ( $GLOBALS['rest'] as $cb ) { $cb(); }
	$v = pharm_clean( array( 'stores' => 77 ) ); $exp = time() + 600;
	ob_start();
	register_shutdown_function( function () { $o = ob_get_clean(); echo json_encode( array( 'len' => strlen( $o ), 'zip' => 'PK' === substr( $o, 0, 2 ), 'hdr' => $GLOBALS['hdr'] ) ); } );
	$GLOBALS['routes']['ph-site/v1/pharmacy-model/download']['callback']( new WP_REST_Request( null, array_merge( $v, array( 'exp' => $exp, 'sig' => pharm_sign( $v, $exp ) ) ) ) );
	exit;
}

/* 1. model */
$d = pharm_clean( array() );
ok( 100 == $d['stores'] && 3 == $d['screens'] && 250 == $d['visits'] && 22 == $d['basket'] && 25 == $d['cpm'] && 5 == $d['uplift'], 'defaults' );
$c = pharm_calc( $d );
ok( abs( $c['media'] - 3285000 ) < 1e-6, 'default media = 3,285,000' );
ok( abs( $c['total'] - ( $c['media'] + $c['basket'] + $c['traffic'] ) ) < 1e-6, 'total is the sum of three streams' );
ok( abs( $c['years'][2]['cum'] - $c['total'] ) < 1e-6 && abs( $c['runRate'] * 36 - $c['total'] ) < 1e-6, 'years and run rate add up' );
$x = pharm_clean( array( 'stores' => 99999, 'cpm' => -4, 'basket' => 'abc', 'evil' => 1, 'uplift' => 80, 'screens' => 0 ) );
ok( 5000 == $x['stores'] && 0 == $x['cpm'] && 22 == $x['basket'] && 50 == $x['uplift'] && 1 == $x['screens'] && ! isset( $x['evil'] ), 'clamping and unknown keys' );
ok( 6 === count( pharm_spec()['fields'] ) && 'stores,screens,visits,basket,cpm,uplift' === implode( ',', array_column( pharm_spec()['fields'], 'id' ) ), 'six inputs in page order' );

/* parity with enhance.js pharmCalc on fixtures + random inputs */
mt_srand( 7 );
$cases = array( $d );
for ( $i = 0; $i < 25; $i++ ) { $cases[] = pharm_clean( array( 'stores' => mt_rand( 1, 5000 ), 'screens' => mt_rand( 1, 50 ), 'visits' => mt_rand( 1, 5000 ), 'basket' => mt_rand( 1, 500 ), 'cpm' => mt_rand( 0, 200 ), 'uplift' => mt_rand( 0, 100 ) / 2 ) ); }
$js = shell_exec( 'node -e ' . escapeshellarg( 'const {pharmCalc}=require(' . json_encode( $dir . '/enhance.js' ) . ');const c=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(c.map(pharmCalc)))' ) . ' < ' . escapeshellarg( ( function () use ( $cases ) { $f = tempnam( sys_get_temp_dir(), 'c' ); file_put_contents( $f, json_encode( $cases ) ); return $f; } )() ) );
$jr = json_decode( (string) $js, true );
ok( is_array( $jr ) && count( $jr ) === count( $cases ), 'node ran pharmCalc on every case' );
foreach ( $cases as $i => $cv ) {
	$p = pharm_calc( $cv ); $j = $jr[ $i ] ?? array();
	ok( $j && abs( $p['media'] - $j['media'] ) < 1e-6 * max( 1, $p['media'] ) && abs( $p['basket'] - $j['basket'] ) < 1e-6 * max( 1, $p['basket'] ) && abs( $p['traffic'] - $j['traffic'] ) < 1e-6 * max( 1, $p['traffic'] ) && abs( $p['total'] - $j['total'] ) < 1e-6 * max( 1, $p['total'] ), "PHP and JS agree on case $i" );
}

/* 2. workbook */
$v = array( 'stores' => 120, 'screens' => 4, 'visits' => 300, 'basket' => 30, 'cpm' => 30, 'uplift' => 7.5 );
$t = tempnam( sys_get_temp_dir(), 'x' ); file_put_contents( $t, pharm_xlsx( $v ) );
$z = new ZipArchive(); ok( true === $z->open( $t ), 'xlsx opens as zip' );
$wb = $z->getFromName( 'xl/workbook.xml' );
foreach ( array( 'Assumptions', '3-Year Monthly Model', '3-Year Summary', 'Sensitivity' ) as $sn ) { ok( false !== strpos( $wb, 'name="' . $sn . '"' ), "sheet $sn" ); }
ok( 4 === substr_count( $wb, '<sheet ' ), 'exactly four sheets' );
$a = $z->getFromName( 'xl/worksheets/sheet1.xml' ); $all = '';
for ( $i = 0; $i < $z->numFiles; $i++ ) { $all .= $z->getFromIndex( $i ); }
foreach ( array( 'C4' => '120', 'C5' => '4', 'C6' => '300', 'C7' => '30', 'C10' => '30' ) as $ref => $val ) {
	ok( (bool) preg_match( '/r="' . $ref . '" s="(2|9)"><v>' . $val . '(\.0+)?<\/v>/', $a ), "yellow input $ref carries $val" );
}
ok( false !== strpos( $a, 'r="C15" s="8"><v>0.075000000000</v>' ) && false !== strpos( $a, 'r="C12" s="8"><v>0.400000000000</v>' ) && false !== strpos( $a, 'r="C16" s="8"><v>0.300000000000</v>' ) && false !== strpos( $a, 'r="C17" s="8"><v>0.030000000000</v>' ), 'percent inputs and presets stored as fractions in yellow cells' );
ok( (bool) preg_match( '/r="C11" s="2"><v>4/', $a ) && (bool) preg_match( '/r="C20" s="2"><v>365/', $a ), 'plays and trading days presets are yellow' );
$sum = $z->getFromName( 'xl/worksheets/sheet3.xml' ); $c2 = pharm_calc( $v );
ok( false !== strpos( $sum, '<f>SUM(E5:E7)</f><v>' . sprintf( '%.12F', $c2['total'] ) ), 'summary 3-year total equals the on-page calc' );
ok( false !== strpos( $all, 'fullCalcOnLoad' ) && false !== strpos( $all, 'definedName name="MediaCPM"' ), 'formulas recalc and names exist' );
ok( ! preg_match( '/\bDSP\b|programmatic|personaliz/i', $all ), 'no DSP, programmatic or US spelling in the workbook' );
ok( false !== strpos( $all, 'Nothing is earned from products that need pharmacist approval' ) && false !== strpos( $all, 'aggregate or de-identified' ) && false !== strpos( $all, 'USD 15-40' ), 'workbook notes present' );
/* telco workbook untouched by the shared helpers */
$tw = telco_xlsx( telco_clean( array() ) ); ok( 3 === substr_count( (string) ( function () use ( $tw ) { $f = tempnam( sys_get_temp_dir(), 't' ); file_put_contents( $f, $tw ); $zz = new ZipArchive(); $zz->open( $f ); return $zz->getFromName( 'xl/workbook.xml' ); } )(), '<sheet ' ), 'telco workbook still has its three sheets' );
/* 2b. recalculate headless (LibreOffice, when installed): every formula result equals its cached value within $1 */
$so = trim( (string) shell_exec( 'command -v soffice libreoffice 2>/dev/null | head -1' ) );
if ( '' === $so ) {
	fwrite( STDOUT, "note: LibreOffice not installed, recalculation check skipped\n" );
} else {
	$w = sys_get_temp_dir() . '/pharm-lo-' . getmypid(); @mkdir( $w );
	copy( $t, $w . '/in.xlsx' );
	shell_exec( escapeshellarg( $so ) . ' --headless -env:UserInstallation=file://' . $w . '/profile --convert-to xlsx --outdir ' . escapeshellarg( $w . '/out' ) . ' ' . escapeshellarg( $w . '/in.xlsx' ) . ' >/dev/null 2>&1' );
	$z2 = new ZipArchive();
	if ( ! file_exists( $w . '/out/in.xlsx' ) || true !== $z2->open( $w . '/out/in.xlsx' ) ) {
		ok( false, 'LibreOffice recalculated the workbook' );
	} else {
		$checked = 0; $worst = 0.0;
		for ( $n = 1; $n <= 4; $n++ ) {
			$orig = array(); preg_match_all( '/<c r="([A-Z]+\d+)"[^>]*><f>[^<]*<\/f><v>([^<]*)<\/v>/', $z->getFromName( "xl/worksheets/sheet$n.xml" ), $mm, PREG_SET_ORDER );
			foreach ( $mm as $x ) { $orig[ $x[1] ] = (float) $x[2]; }
			$lo = array(); preg_match_all( '/<c r="([A-Z]+\d+)"[^>]*>(?:(?!<\/c>).)*?<f[^>]*>(?:[^<]*)<\/f><v>([^<]*)<\/v>/s', $z2->getFromName( "xl/worksheets/sheet$n.xml" ), $m2, PREG_SET_ORDER );
			foreach ( $m2 as $x ) { $lo[ $x[1] ] = (float) $x[2]; }
			foreach ( $orig as $ref => $cv ) {
				$checked++;
				$d = isset( $lo[ $ref ] ) ? abs( $lo[ $ref ] - $cv ) : INF; $worst = max( $worst, $d );
				if ( $d > 1 ) { ok( false, "sheet$n $ref cached $cv vs recalculated " . ( $lo[ $ref ] ?? 'missing' ) ); }
			}
		}
		ok( $checked > 400, "recalculation compared $checked formula cells (worst difference $worst)" );
	}
	shell_exec( 'rm -rf ' . escapeshellarg( $w ) );
}
if ( getenv( 'PHARM_XLSX_OUT' ) ) { copy( $t, getenv( 'PHARM_XLSX_OUT' ) ); }

/* 3. REST */
foreach ( $GLOBALS['rest'] as $cb ) { $cb(); }
$route = $GLOBALS['routes']['ph-site/v1/pharmacy-model'] ?? null; $dl = $GLOBALS['routes']['ph-site/v1/pharmacy-model/download'] ?? null;
ok( $route && 'POST' === $route['methods'] && $dl && 'GET' === $dl['methods'], 'both routes registered' );
$n_ip = 0;
$call = function ( array $b, $ip = null ) use ( $route, &$n_ip ) { $_SERVER['REMOTE_ADDR'] = $ip ?? '10.0.0.' . ( ++$n_ip ); return $route['callback']( new WP_REST_Request( $b ) ); };
$good = array( 'name' => 'Ada Lovelace', 'company' => 'Nimbus Pharmacy', 'email' => 'ada@nimbus.example', 'consent' => true, 'inputs' => $v, 'page' => 'https://personalisationhub.com/industries/pharmacy/' );
$r = $call( array_merge( $good, array( 'website' => 'spam' ) ) ); ok( 200 === $r->status && ! $GLOBALS['posts'] && empty( $r->data['download'] ), 'honeypot pretends success, stores nothing' );
foreach ( array( 'name', 'company' ) as $k ) { $r = $call( array_merge( $good, array( $k => '' ) ) ); ok( 400 === $r->status && $k === $r->data['field'], "$k required" ); }
$r = $call( array_merge( $good, array( 'email' => 'nope' ) ) ); ok( 400 === $r->status && 'email' === $r->data['field'], 'email validated' );
$r = $call( array_merge( $good, array( 'consent' => false ) ) ); ok( 400 === $r->status && 'consent' === $r->data['field'], 'consent required' );
$r = $call( $good );
ok( 200 === $r->status && ! empty( $r->data['download'] ) && false !== strpos( $r->data['download'], 'pharmacy-model/download' ) && false !== strpos( $r->data['download'], 'sig=' ), 'valid post returns a signed link' );
ok( 1 === count( $GLOBALS['posts'] ) && 'pharmacy-business-model' === $GLOBALS['meta'][1]['ph_lead_source'] && 'Pharmacy business model download' === $GLOBALS['meta'][1]['ph_lead_source_label'] && 'pharmacy' === $GLOBALS['meta'][1]['ph_lead_industry'] && (int) round( $c2['total'] ) === (int) $GLOBALS['meta'][1]['ph_lead_estimate'], 'lead fields and 3-year estimate stored' );
$ev = end( $GLOBALS['fired'] );
ok( 'ph_lead_captured' === $ev[0] && 'pharmacy' === $ev[1]['industry'] && 'pharmacy-business-model' === $ev[1]['source'] && false === $ev[1]['test'] && isset( $ev[1]['estimate_3yr'], $ev[1]['inputs'], $ev[1]['post_id'] ), 'ph_lead_captured payload has the telco shape' );
ok( 1 === count( $GLOBALS['mails'] ) && 'New Pharmacy business model lead: Nimbus Pharmacy' === $GLOBALS['mails'][0][1], 'admin email sent' );
/* signed link */
parse_str( parse_url( $r->data['download'], PHP_URL_QUERY ), $q );
$g = function ( $q ) use ( $dl ) { return $dl['callback']( new WP_REST_Request( null, $q ) ); };
$bad = $q; $bad['stores'] = 4000; ok( 403 === $g( $bad )->status, 'tampered link is 403' );
$exp = $q; $exp['exp'] = time() - 5; $exp['sig'] = pharm_sign( pharm_clean( $q ), $exp['exp'] ); ok( 403 === $g( $exp )->status, 'expired link is 403' );
$nos = $q; unset( $nos['sig'] ); ok( 403 === $g( $nos )->status, 'unsigned link is 403' );
ok( $q['exp'] - time() > 86000 && $q['exp'] - time() <= 86400, 'link lasts 24 hours' );
$ch = json_decode( (string) shell_exec( 'php ' . escapeshellarg( __FILE__ ) . ' download' ), true );
ok( $ch && $ch['zip'] && $ch['len'] > 1000 && in_array( 'Content-Disposition: attachment; filename="Personalisation-Hub-Pharmacy-Business-Model.xlsx"', $ch['hdr'], true ), 'valid link streams the xlsx with the right filename' );
/* throttle */
$GLOBALS['tr'] = array(); for ( $i = 0; $i < 6; $i++ ) { $call( array_merge( $good, array( 'email' => "t$i@x.example" ) ), '9.9.9.9' ); }
ok( 429 === $call( $good, '9.9.9.9' )->status, 'seventh request in an hour is throttled' );
/* test flag */
$m0 = count( $GLOBALS['mails'] ); $r = $call( array_merge( $good, array( 'email' => 'test@x.example', 'test' => '1' ) ) );
$tid = count( $GLOBALS['posts'] );
ok( 200 === $r->status && '1' === $GLOBALS['meta'][ $tid ]['ph_lead_test'] && count( $GLOBALS['mails'] ) === $m0, 'test flag stores ph_lead_test and sends no mail' );
/* one lead per person */
$before = count( $GLOBALS['posts'] ); $acts = function ( $id ) { return substr_count( json_encode( $GLOBALS['meta'][ $id ] ), 'Pharmacy business model download' ); };
$call( array_merge( $good, array( 'email' => 'again@x.example' ) ) ); $call( array_merge( $good, array( 'email' => 'again@x.example' ) ) );
ok( count( $GLOBALS['posts'] ) === $before + 1, 'second download by the same person is not a second lead' );
$GLOBALS['meta'][99] = array( 'ph_lead_email' => 'tour@x.example', 'ph_lead_source' => 'product-tour' ); $GLOBALS['posts'][98] = array();
$p0 = count( $GLOBALS['posts'] ); $call( array_merge( $good, array( 'email' => 'tour@x.example' ) ) );
ok( count( $GLOBALS['posts'] ) === $p0 && 'product-tour' === $GLOBALS['meta'][99]['ph_lead_source'] && false !== strpos( json_encode( $GLOBALS['meta'][99] ), 'Pharmacy business model download' ), 'a tour lead then a pharmacy download is one lead with an activity row' );

echo $fails ? "$fails failed\n" : "pharmacy-model.php: all passed\n"; exit( $fails ? 1 : 0 );
}
