<?php
/**
 * Franchise page (13 Nov 2026): personalisationhub.com/franchise/, built from the approved design and HIDDEN until launch.
 *
 * While FRANCHISE_LIVE is false the page is published but linked from nowhere and not indexed: noindex (wp_robots, SEOPress's own
 * robots meta and X-Robots-Tag), left out of the WordPress and SEOPress sitemaps, and absent from llms.txt, the markdown twins and
 * the agent endpoint (none of their allow-lists names it). The header gets a top-level "Franchise" item only on /franchise/ itself.
 * Launching is one change: FRANCHISE_LIVE = true (the item then shows on every page and the noindex is lifted).
 *
 * - The page: created once (slug `franchise`, title "Franchise", content [ph_franchise], template elementor_header_footer, so the site
 *   header and footer and no title bar) behind an add_option lock, the legacy-copy.php pattern.
 * - [ph_franchise] renders the whole page server side (franchise-content.php). franchise.css / franchise.js load on that page only.
 * - POST ph-site/v1/franchise-lead: the product tour gate's lead. One ph_lead per person (lead_find_existing / lead_add_activity),
 *   fires ph_lead_captured so leads.php forwards it to the console as a "Franchise opportunity" (leadType franchise).
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FRANCHISE_LIVE         = false;
const FRANCHISE_SLUG         = 'franchise';
const FRANCHISE_PATH         = '/franchise/';
const FRANCHISE_TITLE        = 'Franchise';
const FRANCHISE_TEMPLATE     = 'elementor_header_footer';
const FRANCHISE_PAGE_OPTION  = 'ph_franchise_page';
const FRANCHISE_LOCK_OPTION  = 'ph_franchise_page_lock';
const FRANCHISE_STATE_OPTION = 'ph_franchise_state';
const FRANCHISE_SOURCE       = 'franchise';
const FRANCHISE_LABEL        = 'Franchise opportunity';
const FRANCHISE_DETAIL       = 'Franchise page – product tour';
const FRANCHISE_BACKGROUNDS  = array( 'Agency media or account management', 'Ad-tech sales or partnerships', 'Retail media', 'Marketing', 'Something else' );
const FRANCHISE_TOUR_PATH    = '/industries/retail-media/tour/';
/** Calculator share of ad revenue. Code only: never printed on the page, in a tooltip, the twin or anything an agent reads. */
const FRANCHISE_INCOME_SHARE = 0.5;

require_once __DIR__ . '/franchise-content.php';

/* ---------- Calculator (mirrors franchise.js) ---------- */

function franchise_defaults() {
	return array( 'ven' => 90, 'dis' => 3, 'vis' => 800, 'cpm' => 25, 'atv' => 25, 'view' => 60, 'up' => 15 );
}

function franchise_calc( array $s ) {
	$s              = array_merge( franchise_defaults(), $s );
	$visitors_month = $s['ven'] * $s['vis'] * 365 / 12;
	$viewers        = $visitors_month * $s['view'] / 100;
	$views_month    = $viewers * $s['dis'];
	$ad_revenue     = $views_month * 12 / 1000 * $s['cpm'];
	return array(
		'venues'        => $s['ven'],
		'displays'      => $s['ven'] * $s['dis'],
		'visitorsMonth' => $visitors_month,
		'viewsMonth'    => $views_month,
		'income'        => $ad_revenue * FRANCHISE_INCOME_SHARE,
		'extraSales'    => $viewers * 12 * $s['atv'] * $s['up'] / 100,
	);
}

function franchise_money( $n ) {
	if ( $n >= 1e6 ) {
		return '$' . number_format( $n / 1e6, 1, '.', '' ) . 'M';
	}
	if ( $n >= 1e3 ) {
		return '$' . round( $n / 1e3 ) . 'K';
	}
	return '$' . round( $n );
}

function franchise_count( $n ) {
	return number_format( (float) $n, ( floor( $n ) == $n ) ? 0 : 1, '.', ',' ); // phpcs:ignore WordPress.PHP.StrictComparisons
}

function franchise_view( array $c ) {
	return array(
		'yours'      => franchise_money( $c['income'] ),
		'venues'     => franchise_count( $c['venues'] ),
		'displays'   => franchise_count( $c['displays'] ),
		'visitors'   => franchise_count( round( $c['visitorsMonth'] ) ),
		'views'      => franchise_count( round( $c['viewsMonth'] ) ),
		'extraSales' => franchise_money( $c['extraSales'] ),
	);
}

/* ---------- The page ---------- */

function franchise_is_live() {
	return (bool) apply_filters( 'ph_franchise_live', FRANCHISE_LIVE );
}

/** True on the /franchise/ page itself (a top-level page with that slug). */
function franchise_is_page() {
	if ( ! function_exists( 'is_page' ) || ! is_page() ) {
		return false;
	}
	$post = get_queried_object();
	return $post instanceof \WP_Post && FRANCHISE_SLUG === $post->post_name && 0 === (int) $post->post_parent;
}

/**
 * Makes sure a published page `franchise` exists. Runs on init; the first request that finds no page creates it, behind an
 * add_option lock (atomic: two requests can never both create it). An existing page with that slug is kept (published if it was
 * not); its id is stored in FRANCHISE_PAGE_OPTION. Returns 'exists' | 'created' | 'published' | 'locked'.
 */
function franchise_ensure_page() {
	$id   = (int) get_option( FRANCHISE_PAGE_OPTION, 0 );
	$post = $id ? get_post( $id ) : null;
	if ( $post && 'page' === $post->post_type && 'publish' === $post->post_status && FRANCHISE_SLUG === $post->post_name ) {
		return 'exists';
	}
	if ( ! add_option( FRANCHISE_LOCK_OPTION, (string) time(), '', 'no' ) ) {
		$at = (int) get_option( FRANCHISE_LOCK_OPTION, 0 );
		if ( $at && $at < time() - 600 ) { // a lock left by a request that died: release it, the next request retries.
			delete_option( FRANCHISE_LOCK_OPTION );
		}
		return 'locked';
	}
	$found  = get_page_by_path( FRANCHISE_SLUG, OBJECT, 'page' );
	$status = 'exists';
	if ( $found && 0 === (int) $found->post_parent ) {
		$id = (int) $found->ID;
		if ( 'publish' !== $found->post_status ) {
			wp_update_post( array( 'ID' => $id, 'post_status' => 'publish' ) );
			$status = 'published';
		}
	} else {
		$id = wp_insert_post( array(
			'post_type'      => 'page',
			'post_status'    => 'publish',
			'post_title'     => FRANCHISE_TITLE,
			'post_name'      => FRANCHISE_SLUG,
			'post_content'   => '[ph_franchise]',
			'post_parent'    => 0,
			'comment_status' => 'closed',
			'ping_status'    => 'closed',
			'meta_input'     => array( '_wp_page_template' => FRANCHISE_TEMPLATE ),
		) );
		$id     = is_wp_error( $id ) ? 0 : (int) $id;
		$status = 'created';
	}
	if ( $id ) {
		update_option( FRANCHISE_PAGE_OPTION, $id, true );
	}
	delete_option( FRANCHISE_LOCK_OPTION );
	return $status;
}

function franchise_page_id() {
	return (int) get_option( FRANCHISE_PAGE_OPTION, 0 );
}

/**
 * Keeps SEOPress's own per-page noindex (`_seopress_robots_index` = yes, which also drops the page from its XML sitemap and is what the
 * agent endpoint reads) in step with FRANCHISE_LIVE. Runs only when the state changes (FRANCHISE_STATE_OPTION).
 */
function franchise_sync_state() {
	$id = franchise_page_id();
	if ( ! $id ) {
		return;
	}
	$want = franchise_is_live() ? 'live' : 'hidden';
	if ( get_option( FRANCHISE_STATE_OPTION ) === $want . ':' . $id ) {
		return;
	}
	if ( 'hidden' === $want ) {
		update_post_meta( $id, '_seopress_robots_index', 'yes' );
	} else {
		delete_post_meta( $id, '_seopress_robots_index' );
	}
	update_option( FRANCHISE_STATE_OPTION, $want . ':' . $id, true );
}

function franchise_init() {
	if ( ( defined( 'WP_CLI' ) && WP_CLI ) || ( function_exists( 'wp_doing_cron' ) && wp_doing_cron() ) ) {
		return;
	}
	franchise_ensure_page();
	franchise_sync_state();
}

/** wp_robots: noindex on /franchise/ while it is not live. */
function franchise_robots( array $robots ) {
	if ( franchise_is_page() && ! franchise_is_live() ) {
		unset( $robots['index'] );
		$robots['noindex'] = true;
	}
	return $robots;
}

/** Sitemap query args (WordPress core and SEOPress): leave the page out while it is not live. */
function franchise_sitemap_args( $args ) {
	$id = franchise_page_id();
	if ( ! is_array( $args ) || ! $id || franchise_is_live() ) {
		return $args;
	}
	$not                 = isset( $args['post__not_in'] ) ? (array) $args['post__not_in'] : array();
	$not[]               = $id;
	$args['post__not_in'] = array_values( array_unique( array_map( 'intval', $not ) ) );
	return $args;
}

/* ---------- Header menu ---------- */

/** A top-level menu item for /franchise/ (an object shaped like wp_setup_nav_menu_item's). */
function franchise_menu_item( $current, $order ) {
	$id   = franchise_page_id();
	$item = (object) array(
		'ID'                    => -91063,
		'db_id'                 => -91063,
		'menu_item_parent'      => '0',
		'object_id'             => (string) $id,
		'object'                => 'page',
		'type'                  => 'post_type',
		'type_label'            => 'Page',
		'post_type'             => 'nav_menu_item',
		'post_status'           => 'publish',
		'post_parent'           => 0,
		'title'                 => FRANCHISE_TITLE,
		'url'                   => home_url( FRANCHISE_PATH ),
		'target'                => '',
		'attr_title'            => '',
		'description'           => '',
		'classes'               => array( 'menu-item', 'menu-item-type-post_type', 'menu-item-object-page', 'ph-franchise-item' ),
		'xfn'                   => '',
		'menu_order'            => $order,
		'current'               => (bool) $current,
		'current_item_ancestor' => false,
		'current_item_parent'   => false,
	);
	if ( $current ) {
		$item->classes[] = 'current-menu-item';
		$item->classes[] = 'current_page_item';
	}
	return $item;
}

function franchise_title_is( $item, array $names ) {
	$t = strtolower( trim( wp_strip_all_tags( (string) ( isset( $item->title ) ? $item->title : '' ) ) ) );
	return in_array( $t, $names, true );
}

/**
 * wp_nav_menu_objects: adds "Franchise" to the header's main menu (the one whose top level has Industry and Support; the ElementsKit
 * widget in header 2330) between Industry and Support. Hidden build: only on /franchise/. Live: on every page. Any other menu (the
 * footer) is untouched, and a menu that already links to /franchise/ is left alone. Pure of globals apart from the arguments.
 */
function franchise_menu_objects( $items, $on_page, $live ) {
	if ( ! is_array( $items ) || ( ! $on_page && ! $live ) ) {
		return $items;
	}
	$industry = -1;
	$support  = -1;
	foreach ( array_values( $items ) as $i => $it ) {
		if ( ! is_object( $it ) ) {
			continue;
		}
		if ( isset( $it->url ) && false !== strpos( (string) $it->url, FRANCHISE_PATH ) && 0 === (int) $it->menu_item_parent ) {
			return $items;
		}
		if ( 0 !== (int) $it->menu_item_parent ) {
			continue;
		}
		if ( franchise_title_is( $it, array( 'industry', 'industries' ) ) ) {
			$industry = $i;
		} elseif ( franchise_title_is( $it, array( 'support', 'support centre' ) ) ) {
			$support = $i;
		}
	}
	if ( $industry < 0 || $support < 0 || $support < $industry ) {
		return $items;
	}
	$items = array_values( $items );
	if ( $on_page ) { // this page is Franchise, not whatever else the menu marked current.
		foreach ( $items as $it ) {
			if ( is_object( $it ) && ! empty( $it->current ) ) {
				$it->current = false;
				$it->classes = array_values( array_diff( (array) $it->classes, array( 'current-menu-item', 'current_page_item' ) ) );
			}
		}
	}
	array_splice( $items, $support, 0, array( franchise_menu_item( $on_page, 0 ) ) );
	foreach ( $items as $n => $it ) {
		if ( is_object( $it ) ) {
			$it->menu_order = $n + 1;
		}
	}
	return $items;
}

/** aria-current="page" on the Franchise link while it is the current page. */
function franchise_menu_link_atts( $atts, $item ) {
	if ( is_object( $item ) && -91063 === (int) $item->ID && ! empty( $item->current ) ) {
		$atts['aria-current'] = 'page';
	}
	return $atts;
}

/* ---------- Franchise lead ---------- */

/** LinkedIn is optional. Returns array( ok, normalised ): https:// added when missing; the host must be linkedin.com or a subdomain. */
function franchise_linkedin( $v ) {
	$v = trim( (string) $v );
	if ( '' === $v ) {
		return array( true, '' );
	}
	if ( strlen( $v ) > 300 || preg_match( '/\s/', $v ) ) {
		return array( false, '' );
	}
	if ( ! preg_match( '#^[a-z][a-z0-9+.-]*://#i', $v ) ) {
		$v = 'https://' . ltrim( $v, '/' );
	}
	$p    = parse_url( $v ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	$host = is_array( $p ) && isset( $p['host'] ) ? strtolower( $p['host'] ) : '';
	$sch  = is_array( $p ) && isset( $p['scheme'] ) ? strtolower( $p['scheme'] ) : '';
	if ( ! in_array( $sch, array( 'http', 'https' ), true ) || ( 'linkedin.com' !== $host && ! preg_match( '/\.linkedin\.com$/', $host ) ) ) {
		return array( false, '' );
	}
	$v = 'https://' . substr( $v, strlen( $sch ) + 3 );
	return array( true, strlen( $v ) > 300 ? '' : $v );
}

/** Validates and stores a franchise lead. Returns array( status, body ). Pure of HTTP, so it is unit-tested. */
function franchise_handle( array $b ) {
	if ( ! empty( $b['website'] ) ) { // honeypot: pretend success.
		return array( 200, array( 'ok' => true ) );
	}
	if ( lead_throttled() ) {
		return array( 429, array( 'error' => 'Too many requests. Try again later.' ) );
	}
	$str  = function ( $k ) use ( $b ) {
		return isset( $b[ $k ] ) && is_string( $b[ $k ] ) ? trim( sanitize_text_field( $b[ $k ] ) ) : '';
	};
	$lead = array( 'name' => $str( 'name' ) );
	if ( '' === $lead['name'] || strlen( $lead['name'] ) > 120 ) {
		return array( 400, array( 'error' => 'Please enter your full name.', 'field' => 'name' ) );
	}
	$lead['email'] = isset( $b['email'] ) && is_string( $b['email'] ) ? sanitize_email( $b['email'] ) : '';
	if ( ! is_email( $lead['email'] ) || strlen( $lead['email'] ) > 120 ) {
		return array( 400, array( 'error' => 'Please enter a valid email address.', 'field' => 'email' ) );
	}
	list( $ok, $li ) = franchise_linkedin( isset( $b['linkedin'] ) && is_string( $b['linkedin'] ) ? $b['linkedin'] : '' );
	if ( ! $ok ) {
		return array( 400, array( 'error' => 'Please enter a LinkedIn profile address, or leave it blank.', 'field' => 'linkedin' ) );
	}
	$lead['linkedin'] = $li;
	$lead['region']   = $str( 'region' );
	if ( '' === $lead['region'] || strlen( $lead['region'] ) > 120 ) {
		return array( 400, array( 'error' => 'Please tell us where you plan to operate.', 'field' => 'region' ) );
	}
	$lead['background'] = $str( 'background' );
	if ( ! in_array( $lead['background'], FRANCHISE_BACKGROUNDS, true ) ) {
		return array( 400, array( 'error' => 'Please choose your background.', 'field' => 'background' ) );
	}
	if ( empty( $b['consent'] ) ) {
		return array( 400, array( 'error' => 'Please tick the box to continue.', 'field' => 'consent' ) );
	}
	$test = lead_is_test( isset( $b['test'] ) ? $b['test'] : false );
	$id   = lead_find_existing( $lead['email'], $test );
	if ( $id ) { // already a lead (an industry tour or download): record the franchise enquiry as activity, not a second lead.
		lead_add_activity( $id, FRANCHISE_LABEL, FRANCHISE_DETAIL );
		foreach ( array( 'linkedin', 'region', 'background' ) as $k ) {
			if ( '' !== $lead[ $k ] && ! get_post_meta( $id, 'ph_lead_' . $k, true ) ) {
				update_post_meta( $id, 'ph_lead_' . $k, $lead[ $k ] );
			}
		}
	} else {
		$id = wp_insert_post( array( 'post_type' => 'ph_lead', 'post_status' => 'private', 'post_title' => $lead['name'] . ' / ' . FRANCHISE_LABEL ) );
		if ( $id && ! is_wp_error( $id ) ) {
			foreach ( $lead as $k => $v ) {
				update_post_meta( $id, 'ph_lead_' . $k, $v );
			}
			update_post_meta( $id, 'ph_lead_source', FRANCHISE_SOURCE );
			update_post_meta( $id, 'ph_lead_source_label', FRANCHISE_LABEL );
			update_post_meta( $id, 'ph_lead_consent', 1 );
			update_post_meta( $id, 'ph_lead_page', FRANCHISE_PATH );
			if ( $test ) {
				update_post_meta( $id, 'ph_lead_test', '1' );
			}
			lead_add_activity( $id, FRANCHISE_LABEL, FRANCHISE_DETAIL );
		} else {
			$id = 0;
		}
	}
	do_action( 'ph_lead_captured', array(
		'company'          => $lead['name'], // today's console needs a company; leadType franchise marks it as an individual.
		'company_industry' => FRANCHISE_LABEL,
		'industry'         => FRANCHISE_SOURCE,
		'contact_name'     => $lead['name'],
		'name'             => $lead['name'],
		'email'            => $lead['email'],
		'linkedin'         => $lead['linkedin'],
		'countries'        => $lead['region'],
		'job_title'        => $lead['background'],
		'region'           => $lead['region'],
		'background'       => $lead['background'],
		'lead_type'        => FRANCHISE_SOURCE,
		'source'           => FRANCHISE_SOURCE,
		'source_label'     => FRANCHISE_LABEL,
		'source_detail'    => FRANCHISE_DETAIL,
		'consent'          => true,
		'page'             => FRANCHISE_PATH,
		'test'             => $test,
		'post_id'          => (int) $id,
	) );
	if ( ! $test ) {
		wp_mail( get_option( 'admin_email' ), 'New franchise enquiry: ' . $lead['name'], "Name: {$lead['name']}\nEmail: {$lead['email']}\nLinkedIn: {$lead['linkedin']}\nWhere they plan to operate: {$lead['region']}\nBackground: {$lead['background']}\nPage: " . FRANCHISE_PATH );
	}
	return array( 200, array( 'ok' => true ) );
}

/* ---------- Hooks ---------- */

if ( function_exists( 'add_action' ) && ! defined( 'PH_FRANCHISE_TEST' ) ) {
	add_action( 'init', __NAMESPACE__ . '\\franchise_init', 25 );

	add_shortcode( 'ph_franchise', function () {
		return franchise_html();
	} );

	add_action( 'wp_enqueue_scripts', function () {
		if ( ! franchise_is_page() ) {
			return;
		}
		$ver = PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063;
		wp_enqueue_style( 'ph-franchise-10063', angie_cs_get_snippet_asset_url( __FILE__, 'franchise.css' ), array(), $ver );
		wp_enqueue_script( 'ph-franchise-10063', angie_cs_get_snippet_asset_url( __FILE__, 'franchise.js' ), array(), $ver, true );
		wp_add_inline_script( 'ph-franchise-10063', 'window.PH_FRANCHISE = ' . wp_json_encode( array( 'endpoint' => '/wp-json/ph-site/v1/franchise-lead', 'tour' => FRANCHISE_TOUR_PATH ) ) . ';', 'before' );
	} );

	add_filter( 'wp_robots', __NAMESPACE__ . '\\franchise_robots', 999 );
	add_action( 'template_redirect', function () {
		if ( franchise_is_page() && ! franchise_is_live() && ! headers_sent() ) {
			header( 'X-Robots-Tag: noindex' );
		}
	}, 1 );
	add_filter( 'wp_sitemaps_posts_query_args', __NAMESPACE__ . '\\franchise_sitemap_args', 99 );
	add_filter( 'seopress_sitemaps_single_query', __NAMESPACE__ . '\\franchise_sitemap_args', 99 );
	add_filter( 'wp_nav_menu_objects', function ( $items ) {
		return franchise_menu_objects( $items, franchise_is_page(), franchise_is_live() );
	}, 20 );
	add_filter( 'nav_menu_link_attributes', __NAMESPACE__ . '\\franchise_menu_link_atts', 20, 2 );

	add_action( 'rest_api_init', function () {
		register_rest_route( 'ph-site/v1', '/franchise-lead', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => function ( \WP_REST_Request $req ) {
				$b = $req->get_json_params();
				list( $status, $out ) = franchise_handle( is_array( $b ) ? $b : array() );
				return new \WP_REST_Response( $out, $status );
			},
		) );
	} );
}
