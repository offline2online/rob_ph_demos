<?php
// php ph-website/tests/ga4.test.php: the pure helpers of snippets/ph-ga4/main.php.
define( 'ABSPATH', __DIR__ );
$GLOBALS['__f'] = array();
function add_action() {} function add_filter() {}
function sanitize_key( $k ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( $k ) ); }
function wp_json_encode( $v ) { return json_encode( $v, JSON_UNESCAPED_SLASHES ); }
require __DIR__ . '/../snippets/ph-ga4/main.php';
use function AngieSnippets\PhGa4___ID__\{industry_of, content_type_of, ga_ids, lead_source_of, add_ids_to_body, head_script};
$fail = 0;
function eq( $got, $want, $what ) { global $fail; if ( $got !== $want ) { $fail++; echo "FAIL $what: got " . var_export( $got, true ) . "\n"; } else { echo "ok   $what\n"; } }
eq( industry_of( '/industries/telco/' ), 'telco', 'industry from page' );
eq( industry_of( '/industries/retail-media' ), 'retail-media', 'industry no slash' );
eq( industry_of( '/industries/telco/tour/' ), 'telco', 'industry from tour path' );
eq( industry_of( '/industries/' ), '', 'hub has no industry' );
eq( industry_of( '/blog/' ), '', 'blog no industry' );
eq( content_type_of( '/industries/pharmacy/' ), 'industry page', 'ct industry' );
eq( content_type_of( '/industries/pharmacy/tour/' ), 'product tour', 'ct tour' );
eq( content_type_of( '/some-post/', array( 'is_post' => true ) ), 'blog', 'ct post' );
eq( content_type_of( '/blog/' ), 'blog', 'ct blog index' );
eq( content_type_of( '/pricing/' ), 'pricing', 'ct pricing' );
eq( content_type_of( '/industries/' ), 'other', 'ct hub' );
eq( ga_ids( array( '_ga' => 'GA1.1.1234567890.1731100000', '_ga_LBEF15GKVQ' => 'GS1.1.1731105000.3.1.1731105100.0.0.0' ) ), array( 'client_id' => '1234567890.1731100000', 'session_id' => '1731105000' ), 'GS1 cookies' );
eq( ga_ids( array( '_ga' => 'GA1.1.99.1731100000', '_ga_LBEF15GKVQ' => 'GS2.1.s1731105000$o3$g1$t1731105100$j0$l0$h0' ) ), array( 'client_id' => '99.1731100000', 'session_id' => '1731105000' ), 'GS2 cookies' );
eq( ga_ids( array( '_ga' => '<script>' ) ), array( 'client_id' => '', 'session_id' => '' ), 'junk cookie rejected' );
eq( ga_ids( array() ), array( 'client_id' => '', 'session_id' => '' ), 'no consent, no cookie, no id' );
eq( lead_source_of( array( 'source' => 'interactive-product-tour' ) ), 'interactive-product-tour', 'lead source' );
eq( lead_source_of( array() ), 'website', 'lead source default' );
eq( add_ids_to_body( '{"company":"A"}', array( 'client_id' => '1.2', 'session_id' => '3', 'lead_source' => 'industry-telco' ) ), '{"company":"A","gaClientId":"1.2","gaSessionId":"3","leadSource":"industry-telco"}', 'ingest body' );
eq( add_ids_to_body( '{"company":"A"}', array( 'client_id' => '' ) ), '{"company":"A"}', 'ingest body without id unchanged' );
eq( false !== strpos( head_script( 'telco', 'industry page' ), '"industry_interest":"telco"' ), true, 'head sets industry_interest' );
eq( false !== strpos( head_script( '', 'blog' ), 'industry_interest' ), false, 'no industry_interest off industry pages' );
eq( false !== strpos( head_script( '', 'blog' ), '{"industry":"none","content_type":"blog"}' ), true, 'head sets none + content_type' );
exit( $fail ? 1 : 0 );
