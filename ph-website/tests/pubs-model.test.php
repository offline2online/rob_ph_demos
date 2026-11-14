<?php
/**
 * php ph-website/tests/pubs-model.test.php : the Pubs & Hospitality model (parity with enhance.js pubsCalc), the workbook, and the
 * lead gate / signed download (pubs-lead.php). Telco and pharmacy workbooks must stay byte-identical (pinned hashes below). The download handler exits, so the streamed-file case runs in a child process.
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
require $dir . '/pubs-lead.php';
use function AngieSnippets\PhIndustryEnhancements_10063\{pubs_spec,pubs_clean,pubs_calc,pubs_xlsx,pubs_sign,telco_clean,telco_xlsx,pharm_clean,pharm_xlsx};

if ( isset( $argv[1] ) && 'download' === $argv[1] ) { // child: stream the file for a signed link and report.
	foreach ( $GLOBALS['rest'] as $cb ) { $cb(); }
	$v = pubs_clean( array( 'venues' => 77 ) ); $exp = time() + 600;
	ob_start();
	register_shutdown_function( function () { $o = ob_get_clean(); echo json_encode( array( 'len' => strlen( $o ), 'zip' => 'PK' === substr( $o, 0, 2 ), 'hdr' => $GLOBALS['hdr'] ) ); } );
	$GLOBALS['routes']['ph-site/v1/pubs-model/download']['callback']( new WP_REST_Request( null, array_merge( $v, array( 'exp' => $exp, 'sig' => pubs_sign( $v, $exp ) ) ) ) );
	exit;
}

/* 1. model */
$d = pubs_clean( array() );
ok( 50 == $d['venues'] && 200 == $d['guests'] && 45 == $d['revenue'] && 60 == $d['reach'] && 5 == $d['uplift'], 'defaults 50 / 200 / 45 / 60% / 5%' );
$c = pubs_calc( $d );
ok( abs( $c['annual'] - 4927500 ) < 1e-6, 'defaults give 4,927,500 a year' );
ok( abs( $c['total'] - 3 * 4927500 ) < 1e-6 && abs( $c['years'][2]['cum'] - $c['total'] ) < 1e-6 && abs( $c['runRate'] * 36 - $c['total'] ) < 1e-6, 'years, 3-year total and run rate add up' );
ok( abs( $c['perGuest'] - 2.25 ) < 1e-9 && abs( $c['perVenue'] - 98550 ) < 1e-6, 'uplift per guest reached and per venue' );
$x = pubs_clean( array( 'venues' => 99999, 'guests' => 0, 'revenue' => 'abc', 'reach' => 140, 'uplift' => -3, 'evil' => 1 ) );
ok( 5000 == $x['venues'] && 1 == $x['guests'] && 45 == $x['revenue'] && 100 == $x['reach'] && 0 == $x['uplift'] && ! isset( $x['evil'] ), 'clamping and unknown keys' );
ok( 'venues,guests,revenue,reach,uplift' === implode( ',', array_column( pubs_spec()['fields'], 'id' ) ) && 365 === pubs_spec()['days'] && 36 === pubs_spec()['months'], 'five inputs in page order; 365 days, 36 months' );
$lim = array(); foreach ( pubs_spec()['fields'] as $f ) { $lim[ $f['id'] ] = array( $f['min'], $f['max'] ); }
ok( array( 1, 5000 ) == $lim['venues'] && array( 1, 5000 ) == $lim['guests'] && array( 1, 500 ) == $lim['revenue'] && array( 0, 100 ) == $lim['reach'] && array( 0, 50 ) == $lim['uplift'], 'min/max limits' );

/* parity with enhance.js pubsCalc on fixtures + random inputs */
mt_srand( 11 );
$cases = array( $d );
for ( $i = 0; $i < 25; $i++ ) { $cases[] = pubs_clean( array( 'venues' => mt_rand( 1, 5000 ), 'guests' => mt_rand( 1, 5000 ), 'revenue' => mt_rand( 2, 1000 ) / 2, 'reach' => mt_rand( 0, 100 ), 'uplift' => mt_rand( 0, 100 ) / 2 ) ); }
$cf = tempnam( sys_get_temp_dir(), 'c' ); file_put_contents( $cf, json_encode( $cases ) );
$js = shell_exec( 'node -e ' . escapeshellarg( 'const {pubsCalc,MODELS}=require(' . json_encode( $dir . '/enhance.js' ) . ');const c=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(c.map(v=>({...pubsCalc(v),page:MODELS.pubs(v).total}))))' ) . ' < ' . escapeshellarg( $cf ) );
$jr = json_decode( (string) $js, true );
ok( is_array( $jr ) && count( $jr ) === count( $cases ), 'node ran pubsCalc on every case' );
foreach ( $cases as $i => $cv ) {
	$p = pubs_calc( $cv ); $j = $jr[ $i ] ?? array();
	$eq = function ( $a, $b ) { return abs( $a - $b ) <= 1e-6 * max( 1, abs( $a ) ); };
	ok( $j && $eq( $p['total'], $j['total'] ) && $eq( $p['total'], $j['page'] ) && $eq( $p['annual'], $j['annual'] ) && $eq( $p['runRate'], $j['runRate'] ) && $eq( $p['reachedYear'], $j['reached'] ), "PHP and JS agree on case $i" );
}

/* 2. workbook */
$v = array( 'venues' => 120, 'guests' => 300, 'revenue' => 38.5, 'reach' => 45, 'uplift' => 7.5 );
$t = tempnam( sys_get_temp_dir(), 'x' ); file_put_contents( $t, pubs_xlsx( $v ) );
$z = new ZipArchive(); ok( true === $z->open( $t ), 'xlsx opens as zip' );
$wb = $z->getFromName( 'xl/workbook.xml' );
foreach ( array( 'Assumptions', '3-Year Monthly Model', '3-Year Summary', 'Sensitivity' ) as $sn ) { ok( false !== strpos( $wb, 'name="' . $sn . '"' ), "sheet $sn" ); }
ok( 4 === substr_count( $wb, '<sheet ' ), 'exactly four sheets' );
$a = $z->getFromName( 'xl/worksheets/sheet1.xml' ); $all = '';
for ( $i = 0; $i < $z->numFiles; $i++ ) { $all .= $z->getFromIndex( $i ); }
foreach ( array( 'C4' => '120', 'C5' => '300', 'C6' => '38.5' ) as $ref => $val ) {
	ok( (bool) preg_match( '/r="' . $ref . '" s="(2|9)"><v>' . preg_quote( $val, '/' ) . '\.?0*<\/v>/', $a ), "yellow input $ref carries $val" );
}
ok( false !== strpos( $a, 'r="C9" s="8"><v>0.450000000000</v>' ) && false !== strpos( $a, 'r="C10" s="8"><v>0.075000000000</v>' ), 'reach and uplift stored as fractions in yellow cells' );
ok( (bool) preg_match( '/r="C13" s="2"><v>365/', $a ), 'trading days is a yellow editable preset' );
ok( false !== strpos( $a, '<f>C4*C5*C13</f>' ) && false !== strpos( $a, '<f>C17*C9</f>' ), 'derived: annual guests and annual guests reached' );
$sum = $z->getFromName( 'xl/worksheets/sheet3.xml' ); $c2 = pubs_calc( $v );
ok( false !== strpos( $sum, '<f>SUM(C5:C7)</f><v>' . sprintf( '%.12F', $c2['total'] ) ), 'summary 3-year total equals the on-page calc' );
ok( false !== strpos( $sum, "'3-Year Monthly Model'!AL17" ) && false !== strpos( $sum, 'C8/3/Assumptions!C4' ) && false !== strpos( $sum, 'Uplift per guest reached' ), 'key metrics: month-36 run rate, per venue per year, per guest reached' );
$mm = $z->getFromName( 'xl/worksheets/sheet2.xml' );
ok( false !== strpos( $mm, 'r="AL17"' ) && false !== strpos( $mm, 'r="AP17"' ) && false !== strpos( $mm, '<f>C12*C15</f>' ) && false !== strpos( $mm, '<f>C7*C8*C9</f>' ) && false !== strpos( $mm, '<f>C13*C14</f>' ), 'monthly model: 36 months, totals and every step' );
$sv = $z->getFromName( 'xl/worksheets/sheet4.xml' );
ok( 9 === substr_count( $sv, 'Assumptions!$C$17*$A' ) && false !== strpos( $sv, 'r="A5" s="5"><v>0.400000000000' ) && false !== strpos( $sv, 'r="D4" s="5"><v>0.075000000000' ), 'sensitivity: reach 40/60/80 against uplift 2.5/5/7.5, all formulas' );
ok( false !== strpos( $all, 'fullCalcOnLoad' ) && false !== strpos( $all, 'definedName name="RevenuePerHead"' ) && false !== strpos( $all, 'definedName name="GuestReach"' ), 'formulas recalc and names exist' );
ok( ! preg_match( '/\bDSP\b|programmatic|personaliz|Guinness|Heineken|Carlsberg|Diageo|InBev|Coca-Cola|Pepsi|Wetherspoon|Mitchells|Greene King|Marston|Stonegate|Fuller/i', $all ), 'no brand names, DSP, programmatic or US spelling in the workbook' );
ok( false !== strpos( $all, 'All figures are in USD' ) && false !== strpos( $all, 'not a guarantee' ) && false !== strpos( $all, 'own customer and loyalty data, or aggregate data only' ), 'workbook notes present' );
/* parity: the untouched workbook's 3-year total equals the JS calc for the same inputs */
$jv = json_decode( (string) shell_exec( 'node -e ' . escapeshellarg( 'const {pubsCalc}=require(' . json_encode( $dir . '/enhance.js' ) . ');console.log(pubsCalc(' . json_encode( $v ) . ').total)' ) ), true );
ok( is_numeric( $jv ) && false !== strpos( $sum, '<f>SUM(C5:C7)</f><v>' . sprintf( '%.12F', $jv ) ), 'workbook 3-year total equals the JS calc' );
/* telco and pharmacy workbooks are byte-identical part for part (hashes pinned before the pubs workbook existed) */
$parts = function ( $b ) { $f = tempnam( sys_get_temp_dir(), 'h' ); file_put_contents( $f, $b ); $zz = new ZipArchive(); $zz->open( $f ); $o = ''; for ( $i = 0; $i < $zz->numFiles; $i++ ) { $o .= $zz->getNameIndex( $i ) . "\n" . $zz->getFromIndex( $i ) . "\n"; } return hash( 'sha256', $o ); };
ok( '2efc3e291c91184c51a04fb9604559a058fde3688e152a1ff98c46fee248147e' === $parts( telco_xlsx( telco_clean( array() ) ) ), 'telco workbook byte-identical' );
ok( 'a5aea67840e860a51f948843f6c116f8748e34702148080a20c2a5ed34b539cd' === $parts( pharm_xlsx( pharm_clean( array() ) ) ), 'pharmacy workbook byte-identical' );
/* 2b. recalculate headless (LibreOffice, when installed): every formula result equals its cached value within $1 */
$so = trim( (string) shell_exec( 'command -v soffice libreoffice 2>/dev/null | head -1' ) );
if ( '' === $so ) {
	fwrite( STDOUT, "note: LibreOffice not installed, recalculation check skipped\n" );
} else {
	$w = sys_get_temp_dir() . '/pubs-lo-' . getmypid(); @mkdir( $w );
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
		ok( $checked > 150, "recalculation compared $checked formula cells (worst difference $worst)" );
	}
	shell_exec( 'rm -rf ' . escapeshellarg( $w ) );
}
if ( getenv( 'PUBS_XLSX_OUT' ) ) { copy( $t, getenv( 'PUBS_XLSX_OUT' ) ); }

/* 3. REST */
foreach ( $GLOBALS['rest'] as $cb ) { $cb(); }
$route = $GLOBALS['routes']['ph-site/v1/pubs-model'] ?? null; $dl = $GLOBALS['routes']['ph-site/v1/pubs-model/download'] ?? null;
ok( $route && 'POST' === $route['methods'] && $dl && 'GET' === $dl['methods'], 'both routes registered' );
$n_ip = 0;
$call = function ( array $b, $ip = null ) use ( $route, &$n_ip ) { $_SERVER['REMOTE_ADDR'] = $ip ?? '10.0.0.' . ( ++$n_ip ); return $route['callback']( new WP_REST_Request( $b ) ); };
$good = array( 'name' => 'Ada Lovelace', 'company' => 'Nimbus Taverns', 'email' => 'ada@nimbus.example', 'consent' => true, 'inputs' => $v, 'page' => 'https://personalisationhub.com/industries/hospitality/' );
$r = $call( array_merge( $good, array( 'website' => 'spam' ) ) ); ok( 200 === $r->status && ! $GLOBALS['posts'] && empty( $r->data['download'] ), 'honeypot pretends success, stores nothing' );
foreach ( array( 'name', 'company' ) as $k ) { $r = $call( array_merge( $good, array( $k => '' ) ) ); ok( 400 === $r->status && $k === $r->data['field'], "$k required" ); }
$r = $call( array_merge( $good, array( 'email' => 'nope' ) ) ); ok( 400 === $r->status && 'email' === $r->data['field'], 'email validated' );
$r = $call( array_merge( $good, array( 'consent' => false ) ) ); ok( 400 === $r->status && 'consent' === $r->data['field'], 'consent required' );
$r = $call( $good );
ok( 200 === $r->status && ! empty( $r->data['download'] ) && false !== strpos( $r->data['download'], 'pubs-model/download' ) && false !== strpos( $r->data['download'], 'sig=' ), 'valid post returns a signed link' );
ok( 1 === count( $GLOBALS['posts'] ) && 'pubs-business-model' === $GLOBALS['meta'][1]['ph_lead_source'] && 'Pubs & Hospitality business model download' === $GLOBALS['meta'][1]['ph_lead_source_label'] && 'pubs-hospitality' === $GLOBALS['meta'][1]['ph_lead_industry'] && (int) round( $c2['total'] ) === (int) $GLOBALS['meta'][1]['ph_lead_estimate'], 'lead fields and 3-year estimate stored' );
$ev = end( $GLOBALS['fired'] );
ok( 'ph_lead_captured' === $ev[0] && 'pubs-hospitality' === $ev[1]['industry'] && 'pubs-business-model' === $ev[1]['source'] && false === $ev[1]['test'] && isset( $ev[1]['estimate_3yr'], $ev[1]['inputs'], $ev[1]['post_id'] ), 'ph_lead_captured payload has the telco shape' );
ok( 1 === count( $GLOBALS['mails'] ) && 'New Pubs & Hospitality business model lead: Nimbus Taverns' === $GLOBALS['mails'][0][1], 'admin email sent' );
/* signed link */
parse_str( parse_url( $r->data['download'], PHP_URL_QUERY ), $q );
$g = function ( $q ) use ( $dl ) { return $dl['callback']( new WP_REST_Request( null, $q ) ); };
$bad = $q; $bad['venues'] = 4000; ok( 403 === $g( $bad )->status, 'tampered link is 403' );
$exp = $q; $exp['exp'] = time() - 5; $exp['sig'] = pubs_sign( pubs_clean( $q ), $exp['exp'] ); ok( 403 === $g( $exp )->status, 'expired link is 403' );
$nos = $q; unset( $nos['sig'] ); ok( 403 === $g( $nos )->status, 'unsigned link is 403' );
ok( $q['exp'] - time() > 86000 && $q['exp'] - time() <= 86400, 'link lasts 24 hours' );
$ch = json_decode( (string) shell_exec( 'php ' . escapeshellarg( __FILE__ ) . ' download' ), true );
ok( $ch && $ch['zip'] && $ch['len'] > 1000 && in_array( 'Content-Disposition: attachment; filename="Personalisation-Hub-Pubs-Hospitality-Business-Model.xlsx"', $ch['hdr'], true ), 'valid link streams the xlsx with the right filename' );
/* throttle */
$GLOBALS['tr'] = array(); for ( $i = 0; $i < 6; $i++ ) { $call( array_merge( $good, array( 'email' => "t$i@x.example" ) ), '9.9.9.9' ); }
ok( 429 === $call( $good, '9.9.9.9' )->status, 'seventh request in an hour is throttled' );
/* test flag */
$m0 = count( $GLOBALS['mails'] ); $r = $call( array_merge( $good, array( 'email' => 'test@x.example', 'test' => '1' ) ) );
$tid = count( $GLOBALS['posts'] );
ok( 200 === $r->status && '1' === $GLOBALS['meta'][ $tid ]['ph_lead_test'] && count( $GLOBALS['mails'] ) === $m0, 'test flag stores ph_lead_test and sends no mail' );
/* one lead per person */
$before = count( $GLOBALS['posts'] ); $acts = function ( $id ) { return substr_count( json_encode( $GLOBALS['meta'][ $id ] ), 'Pubs & Hospitality business model download' ); };
$call( array_merge( $good, array( 'email' => 'again@x.example' ) ) ); $call( array_merge( $good, array( 'email' => 'again@x.example' ) ) );
ok( count( $GLOBALS['posts'] ) === $before + 1, 'second download by the same person is not a second lead' );
$GLOBALS['meta'][99] = array( 'ph_lead_email' => 'tour@x.example', 'ph_lead_source' => 'product-tour' ); $GLOBALS['posts'][98] = array();
$p0 = count( $GLOBALS['posts'] ); $call( array_merge( $good, array( 'email' => 'tour@x.example' ) ) );
ok( count( $GLOBALS['posts'] ) === $p0 && 'product-tour' === $GLOBALS['meta'][99]['ph_lead_source'] && false !== strpos( json_encode( $GLOBALS['meta'][99] ), json_encode( 'Pubs & Hospitality business model download' ) ), 'a tour lead then a pubs download is one lead with an activity row' );

/* either order leaves one lead with two activity rows (the pubs tour is a later ticket; it records itself as the other tours do) */
$TOUR = 'Interactive product tour – Pubs & Hospitality'; $DL = 'Pubs & Hospitality business model download';
$GLOBALS['tr'] = array(); $GLOBALS['posts'] = array(); $GLOBALS['meta'] = array();
$GLOBALS['posts'][] = array(); $GLOBALS['meta'][1] = array( 'ph_lead_email' => 'order1@x.example', 'ph_lead_source' => 'interactive-product-tour' );
AngieSnippets\PhIndustryEnhancements_10063\lead_add_activity( 1, $TOUR );
$call( array_merge( $good, array( 'email' => 'order1@x.example' ) ) );
ok( 1 === count( $GLOBALS['posts'] ) && array( $TOUR, $DL ) === array_column( $GLOBALS['meta'][1]['ph_lead_activity'], 'label' ), 'tour then download: one lead, two activity rows' );
$call( array_merge( $good, array( 'email' => 'order2@x.example' ) ) );
$id2 = AngieSnippets\PhIndustryEnhancements_10063\lead_find_existing( 'order2@x.example', false );
ok( 2 === $id2, 'download then tour: the tour finds the download lead' );
AngieSnippets\PhIndustryEnhancements_10063\lead_add_activity( $id2, $TOUR );
ok( 2 === count( $GLOBALS['posts'] ) && array( $DL, $TOUR ) === array_column( $GLOBALS['meta'][2]['ph_lead_activity'], 'label' ), 'download then tour: one lead, two activity rows' );

echo $fails ? "$fails failed\n" : "pubs-model.php: all passed\n"; exit( $fails ? 1 : 0 );
}
