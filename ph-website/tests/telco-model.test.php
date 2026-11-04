<?php
/** php ph-website/tests/telco-model.test.php : model vs the reference workbook figures, workbook structure, clamping. */
define( 'PH_TELCO_MODEL_TEST', 1 );
require dirname( __DIR__ ) . '/snippets/ph-industry-enhancements/telco-model.php';
use function AngieSnippets\PhIndustryEnhancements_10063\{telco_spec,telco_clean,telco_calc,telco_xlsx};
$f = 0;
function ok( $c, $m ) { global $f; if ( ! $c ) { $f++; fwrite( STDERR, "FAIL: $m\n" ); } }
$d = telco_clean( array() );
$c = telco_calc( $d );
ok( abs( $c['total'] - 72307145.4010927 ) < 0.01, 'default 3-year total matches the reference model: ' . $c['total'] );
ok( abs( $c['years'][0]['s1'] - 644387.7365407471 ) < 0.01 && abs( $c['years'][0]['s2'] - 9182525.245705644 ) < 0.01, 'year 1 streams' );
ok( abs( $c['years'][2]['total'] - 37274230.39341863 ) < 0.01, 'year 3 total' );
ok( abs( $c['runRate'] - 3499656.4714062694 ) < 0.01 && abs( $c['base'] - 71421.56064094427 ) < 0.001, 'month-36 run rate and base' );
$x = telco_clean( array( 'stores' => 99999, 'churn' => -4, 'arpu' => 'abc', 'evil' => 1 ) );
ok( 5000 === (int) $x['stores'] && 0 === (int) $x['churn'] && 49 === (int) $x['arpu'] && ! isset( $x['evil'] ), 'clamping and unknown keys' );
$v = array( 'stores' => 120, 'footfall' => 70, 'conv' => 12, 'arpu' => 60, 'walk' => 2, 'uplift' => 20, 'churn' => 1.5 );
$b = telco_xlsx( $v );
$t = tempnam( sys_get_temp_dir(), 'x' ); file_put_contents( $t, $b );
$z = new ZipArchive(); ok( true === $z->open( $t ), 'xlsx opens as zip' );
$a = $z->getFromName( 'xl/worksheets/sheet1.xml' ); $all = '';
for ( $i = 0; $i < $z->numFiles; $i++ ) { $all .= $z->getFromIndex( $i ); }
foreach ( array( 'C4' => '120', 'C14' => '2', 'C17' => '70', 'C20' => '60' ) as $ref => $val ) {
	ok( (bool) preg_match( '/r="' . $ref . '" s="2"><v>' . $val . '(\.0+)?<\/v>/', $a ), "assumptions $ref carries $val" );
}
ok( false !== strpos( $a, '<v>0.120000000000</v>' ) && false !== strpos( $a, '<v>0.200000000000</v>' ) && false !== strpos( $a, '<v>0.015000000000</v>' ), 'percent inputs stored as fractions' );
$sum = $z->getFromName( 'xl/worksheets/sheet3.xml' ); $c2 = telco_calc( $v );
ok( false !== strpos( $sum, sprintf( '%.12F', $c2['total'] ) ), 'summary total equals the on-page calc' );
ok( ! preg_match( '/one\s*nz|one new zealand|vodafone|spark|telstra|optus/i', $all ), 'no client or brand names in the workbook' );
ok( false !== strpos( $all, 'fullCalcOnLoad' ) && false !== strpos( $all, 'definedName name="ARPU"' ), 'formulas recalc and names exist' );
echo $f ? "$f failed\n" : "telco-model: all passed\n"; exit( $f ? 1 : 0 );
