<?php
/**
 * PH Support Centre page template: the site's own header and footer around the server-rendered Support Centre view.
 * Chosen by main.php through template_include, so every plugin's normal front-end set-up has run.
 */

namespace AngieSnippets\PhSupportCentre_10156;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( __NAMESPACE__ . '\\view' ) || ! did_action( 'template_redirect' ) ) {
	return;
}
$ph_sc_view = view();
if ( ! $ph_sc_view ) {
	return;
}
status_header( 'notfound' === $ph_sc_view['type'] ? 404 : 200 );
get_header();
echo render( $ph_sc_view ); // phpcs:ignore WordPress.Security.EscapeOutput -- built from escaped parts and the sanitised body.
get_footer();
