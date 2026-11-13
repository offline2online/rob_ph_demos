<?php
/**
 * Be Your Own Boss page (13 Nov 2026): personalisationhub.com/be-your-own-boss/, built from the approved design and HIDDEN until launch.
 * The offer is "network operator" and its leads are "Network operator inquiry". The retired offer name appears nowhere: not in what a
 * visitor sees, and not in a file, function, constant, option, route, key, class, comment or test.
 *
 * While OPERATOR_LIVE is false the page is published but linked from nowhere and not indexed: noindex (wp_robots, SEOPress's own
 * robots meta and X-Robots-Tag), left out of the WordPress and SEOPress sitemaps, and absent from llms.txt, the markdown twins and
 * the agent endpoint (none of their allow-lists names it). The header gets a top-level "Be Your Own Boss" item only on the page itself.
 * Launching is one change: OPERATOR_LIVE = true (the item then shows on every page and the noindex is lifted).
 *
 * - The page: page 10776 on the live site (OPERATOR_PAGE_ID). operator_ensure_page() migrates it once, by id, behind an add_option lock:
 *   slug `be-your-own-boss`, title "Be Your Own Boss", content [ph_operator], its _wp_old_slug meta removed, id stored in ph_operator_page.
 *   A site without that page gets it created (template elementor_header_footer: the site header and footer, no title bar). Never two.
 *   The page's earlier URL is not redirected: it was never public, so it is a 404.
 * - [ph_operator] renders the whole page server side (operator-content.php). operator.css / operator.js load on that page only.
 * - POST ph-site/v1/operator-lead: the product tour gate's lead. One ph_lead per person (lead_find_existing / lead_add_activity),
 *   fires ph_lead_captured so leads.php forwards it to the console as a "Network operator inquiry" (leadType "operator").
 */
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const OPERATOR_LIVE          = false;
const OPERATOR_SLUG          = 'be-your-own-boss';
const OPERATOR_PATH          = '/be-your-own-boss/';
const OPERATOR_TITLE         = 'Be Your Own Boss';
const OPERATOR_DOC_TITLE     = 'Be Your Own Boss - Personalisation Hub';
/** The existing hidden page on the live site, migrated by id (operator_ensure_page). */
const OPERATOR_PAGE_ID       = 10776;
const OPERATOR_SHORTCODE     = 'ph_operator';
const OPERATOR_TEMPLATE      = 'elementor_header_footer';
const OPERATOR_PAGE_OPTION   = 'ph_operator_page';
const OPERATOR_LOCK_OPTION   = 'ph_operator_page_lock';
const OPERATOR_STATE_OPTION  = 'ph_operator_state';
/** Internal key (ph_lead_source, industry, lead_type / leadType): the console routes network operator leads on it. */
const OPERATOR_SOURCE        = 'operator';
const OPERATOR_LABEL         = 'Network operator inquiry';
const OPERATOR_DETAIL        = 'Be Your Own Boss page – product tour';
const OPERATOR_BACKGROUNDS   = array( 'Agency media or account management', 'Ad-tech sales or partnerships', 'Retail media', 'Marketing', 'Something else' );
const OPERATOR_TOUR_PATH     = '/industries/retail-media/tour/';
/** Calculator share of ad revenue. Code only: never printed on the page, in a tooltip, the twin or anything an agent reads. */
const OPERATOR_INCOME_SHARE  = 0.5;

require_once __DIR__ . '/operator-content.php';

/* ---------- Calculator (mirrors operator.js) ---------- */

function operator_defaults() {
	return array( 'ven' => 90, 'dis' => 3, 'vis' => 800, 'cpm' => 25, 'atv' => 25, 'view' => 60, 'up' => 15 );
}

function operator_calc( array $s ) {
	$s              = array_merge( operator_defaults(), $s );
	$visitors_month = $s['ven'] * $s['vis'] * 365 / 12;
	$viewers        = $visitors_month * $s['view'] / 100;
	$views_month    = $viewers * $s['dis'];
	$ad_revenue     = $views_month * 12 / 1000 * $s['cpm'];
	return array(
		'venues'        => $s['ven'],
		'displays'      => $s['ven'] * $s['dis'],
		'visitorsMonth' => $visitors_month,
		'viewsMonth'    => $views_month,
		'income'        => $ad_revenue * OPERATOR_INCOME_SHARE,
		'extraSales'    => $viewers * 12 * $s['atv'] * $s['up'] / 100,
	);
}

function operator_money( $n ) {
	if ( $n >= 1e6 ) {
		return '$' . number_format( $n / 1e6, 1, '.', '' ) . 'M';
	}
	if ( $n >= 1e3 ) {
		return '$' . round( $n / 1e3 ) . 'K';
	}
	return '$' . round( $n );
}

function operator_count( $n ) {
	return number_format( (float) $n, ( floor( $n ) == $n ) ? 0 : 1, '.', ',' ); // phpcs:ignore WordPress.PHP.StrictComparisons
}

function operator_view( array $c ) {
	return array(
		'yours'      => operator_money( $c['income'] ),
		'venues'     => operator_count( $c['venues'] ),
		'displays'   => operator_count( $c['displays'] ),
		'visitors'   => operator_count( round( $c['visitorsMonth'] ) ),
		'views'      => operator_count( round( $c['viewsMonth'] ) ),
		'extraSales' => operator_money( $c['extraSales'] ),
	);
}

/* ---------- The page ---------- */

function operator_is_live() {
	return (bool) apply_filters( 'ph_operator_live', OPERATOR_LIVE );
}

/** True on the /be-your-own-boss/ page itself (a top-level page with that slug). */
function operator_is_page() {
	if ( ! function_exists( 'is_page' ) || ! is_page() ) {
		return false;
	}
	$post = get_queried_object();
	return $post instanceof \WP_Post && OPERATOR_SLUG === $post->post_name && 0 === (int) $post->post_parent;
}

/** True when $post is the finished page: a published top-level page on the Be Your Own Boss slug. */
function operator_page_ready( $post ) {
	return $post instanceof \WP_Post && 'page' === $post->post_type && 'publish' === $post->post_status
		&& OPERATOR_SLUG === $post->post_name && 0 === (int) $post->post_parent;
}

/**
 * Makes sure the published page `be-your-own-boss` exists. Runs on init. Once ph_operator_page names a finished page it returns
 * 'exists' at once; anything else happens behind an add_option lock (atomic: two requests can never both act), so it is done once:
 * - the page to keep is the stored one, else page OPERATOR_PAGE_ID (10776, the existing hidden page, found by id; only while its content
 *   is one of our [ph_...] shortcodes), else a top-level page
 *   already on the slug; it gets post_name be-your-own-boss, post_title "Be Your Own Boss", post_content [ph_operator] and is
 *   published, and its _wp_old_slug meta is deleted, so its earlier URL leads nowhere;
 * - only when none of those exists is the page created. It never makes a second page.
 * Returns 'exists' | 'migrated' | 'created' | 'locked' | 'failed' (an update WordPress refused: retried on the next request).
 */
function operator_ensure_page() {
	$id   = (int) get_option( OPERATOR_PAGE_OPTION, 0 );
	$post = $id ? get_post( $id ) : null;
	if ( operator_page_ready( $post ) ) {
		return 'exists';
	}
	if ( ! add_option( OPERATOR_LOCK_OPTION, (string) time(), '', 'no' ) ) {
		$at = (int) get_option( OPERATOR_LOCK_OPTION, 0 );
		if ( $at && $at < time() - 600 ) { // a lock left by a request that died: release it, the next request retries.
			delete_option( OPERATOR_LOCK_OPTION );
		}
		return 'locked';
	}
	$found = null;
	$known = get_post( OPERATOR_PAGE_ID );
	if ( $known instanceof \WP_Post && 0 !== strpos( ltrim( (string) $known->post_content ), '[ph_' ) ) {
		$known = null; // 10776 is some other page on this site (not one of our shortcode pages): never touch it.
	}
	foreach ( array( $post, $known ) as $p ) {
		if ( $p instanceof \WP_Post && 'page' === $p->post_type && 'trash' !== $p->post_status ) {
			$found = $p;
			break;
		}
	}
	if ( ! $found ) {
		$p = get_page_by_path( OPERATOR_SLUG, OBJECT, 'page' );
		if ( $p && 0 === (int) $p->post_parent ) {
			$found = $p;
		}
	}
	if ( $found ) {
		$id  = (int) $found->ID;
		$res = wp_update_post( array(
			'ID'           => $id,
			'post_name'    => OPERATOR_SLUG,
			'post_title'   => OPERATOR_TITLE,
			'post_content' => '[' . OPERATOR_SHORTCODE . ']',
			'post_status'  => 'publish',
			'post_parent'  => 0,
		), true );
		if ( ! $res || is_wp_error( $res ) ) {
			delete_option( OPERATOR_LOCK_OPTION );
			return 'failed';
		}
		delete_post_meta( $id, '_wp_old_slug' );
		$status = 'migrated';
	} else {
		$id = wp_insert_post( array(
			'post_type'      => 'page',
			'post_status'    => 'publish',
			'post_title'     => OPERATOR_TITLE,
			'post_name'      => OPERATOR_SLUG,
			'post_content'   => '[' . OPERATOR_SHORTCODE . ']',
			'post_parent'    => 0,
			'comment_status' => 'closed',
			'ping_status'    => 'closed',
			'meta_input'     => array( '_wp_page_template' => OPERATOR_TEMPLATE ),
		) );
		$id     = is_wp_error( $id ) ? 0 : (int) $id;
		$status = $id ? 'created' : 'failed';
	}
	if ( $id ) {
		update_option( OPERATOR_PAGE_OPTION, $id, true );
	}
	delete_option( OPERATOR_LOCK_OPTION );
	return $status;
}

function operator_page_id() {
	return (int) get_option( OPERATOR_PAGE_OPTION, 0 );
}

/**
 * Keeps SEOPress's own per-page noindex (`_seopress_robots_index` = yes, which also drops the page from its XML sitemap and is what the
 * agent endpoint reads) in step with OPERATOR_LIVE. Runs only when the state changes (OPERATOR_STATE_OPTION).
 */
function operator_sync_state() {
	$id = operator_page_id();
	if ( ! $id ) {
		return;
	}
	$want = operator_is_live() ? 'live' : 'hidden';
	if ( get_option( OPERATOR_STATE_OPTION ) === $want . ':' . $id ) {
		return;
	}
	if ( 'hidden' === $want ) {
		update_post_meta( $id, '_seopress_robots_index', 'yes' );
	} else {
		delete_post_meta( $id, '_seopress_robots_index' );
	}
	update_option( OPERATOR_STATE_OPTION, $want . ':' . $id, true );
}

function operator_init() {
	if ( ( defined( 'WP_CLI' ) && WP_CLI ) || ( function_exists( 'wp_doing_cron' ) && wp_doing_cron() ) ) {
		return;
	}
	operator_ensure_page();
	operator_sync_state();
}

/** wp_robots: noindex on the page while it is not live. */
function operator_robots( array $robots ) {
	if ( operator_is_page() && ! operator_is_live() ) {
		unset( $robots['index'] );
		$robots['noindex'] = true;
	}
	return $robots;
}

/** The browser and SEOPress title on the page: "Be Your Own Boss - Personalisation Hub". Other pages are untouched. */
function operator_document_title( $title ) {
	return operator_is_page() ? OPERATOR_DOC_TITLE : $title;
}

/** Sitemap query args (WordPress core and SEOPress): leave the page out while it is not live. */
function operator_sitemap_args( $args ) {
	$id = operator_page_id();
	if ( ! is_array( $args ) || ! $id || operator_is_live() ) {
		return $args;
	}
	$not                 = isset( $args['post__not_in'] ) ? (array) $args['post__not_in'] : array();
	$not[]               = $id;
	$args['post__not_in'] = array_values( array_unique( array_map( 'intval', $not ) ) );
	return $args;
}

/* ---------- Header menu ---------- */

/** A top-level "Be Your Own Boss" menu item for /be-your-own-boss/ (an object shaped like wp_setup_nav_menu_item's). */
function operator_menu_item( $current, $order ) {
	$id   = operator_page_id();
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
		'title'                 => OPERATOR_TITLE,
		'url'                   => home_url( OPERATOR_PATH ),
		'target'                => '',
		'attr_title'            => '',
		'description'           => '',
		'classes'               => array( 'menu-item', 'menu-item-type-post_type', 'menu-item-object-page', 'ph-boss-item' ),
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

function operator_title_is( $item, array $names ) {
	$t = strtolower( trim( wp_strip_all_tags( (string) ( isset( $item->title ) ? $item->title : '' ) ) ) );
	return in_array( $t, $names, true );
}

/**
 * wp_nav_menu_objects: adds "Be Your Own Boss" to the header's main menu (the one whose top level has Industry and Support; the
 * ElementsKit widget in header 2330) between Industry and Support. Hidden build: only on /be-your-own-boss/. Live: on every page. Any
 * other menu (the footer) is untouched, and a menu that already links to /be-your-own-boss/ is left alone. Pure of globals apart from
 * the arguments.
 */
function operator_menu_objects( $items, $on_page, $live ) {
	if ( ! is_array( $items ) || ( ! $on_page && ! $live ) ) {
		return $items;
	}
	$industry = -1;
	$support  = -1;
	foreach ( array_values( $items ) as $i => $it ) {
		if ( ! is_object( $it ) ) {
			continue;
		}
		if ( isset( $it->url ) && false !== strpos( (string) $it->url, OPERATOR_PATH ) && 0 === (int) $it->menu_item_parent ) {
			return $items;
		}
		if ( 0 !== (int) $it->menu_item_parent ) {
			continue;
		}
		if ( operator_title_is( $it, array( 'industry', 'industries' ) ) ) {
			$industry = $i;
		} elseif ( operator_title_is( $it, array( 'support', 'support centre' ) ) ) {
			$support = $i;
		}
	}
	if ( $industry < 0 || $support < 0 || $support < $industry ) {
		return $items;
	}
	$items = array_values( $items );
	if ( $on_page ) { // this page is Be Your Own Boss, not whatever else the menu marked current.
		foreach ( $items as $it ) {
			if ( is_object( $it ) && ! empty( $it->current ) ) {
				$it->current = false;
				$it->classes = array_values( array_diff( (array) $it->classes, array( 'current-menu-item', 'current_page_item' ) ) );
			}
		}
	}
	array_splice( $items, $support, 0, array( operator_menu_item( $on_page, 0 ) ) );
	foreach ( $items as $n => $it ) {
		if ( is_object( $it ) ) {
			$it->menu_order = $n + 1;
		}
	}
	return $items;
}

/** aria-current="page" on the Be Your Own Boss link while it is the current page. */
function operator_menu_link_atts( $atts, $item ) {
	if ( is_object( $item ) && -91063 === (int) $item->ID && ! empty( $item->current ) ) {
		$atts['aria-current'] = 'page';
	}
	return $atts;
}

/* ---------- Network operator lead ---------- */

/** LinkedIn is optional. Returns array( ok, normalised ): https:// added when missing; the host must be linkedin.com or a subdomain. */
function operator_linkedin( $v ) {
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

/** Validates and stores a network operator lead. Returns array( status, body ). Pure of HTTP, so it is unit-tested. */
function operator_handle( array $b ) {
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
	list( $ok, $li ) = operator_linkedin( isset( $b['linkedin'] ) && is_string( $b['linkedin'] ) ? $b['linkedin'] : '' );
	if ( ! $ok ) {
		return array( 400, array( 'error' => 'Please enter a LinkedIn profile address, or leave it blank.', 'field' => 'linkedin' ) );
	}
	$lead['linkedin'] = $li;
	$lead['region']   = $str( 'region' );
	if ( '' === $lead['region'] || strlen( $lead['region'] ) > 120 ) {
		return array( 400, array( 'error' => 'Please tell us where you plan to operate.', 'field' => 'region' ) );
	}
	$lead['background'] = $str( 'background' );
	if ( ! in_array( $lead['background'], OPERATOR_BACKGROUNDS, true ) ) {
		return array( 400, array( 'error' => 'Please choose your background.', 'field' => 'background' ) );
	}
	if ( empty( $b['consent'] ) ) {
		return array( 400, array( 'error' => 'Please tick the box to continue.', 'field' => 'consent' ) );
	}
	$test = lead_is_test( isset( $b['test'] ) ? $b['test'] : false );
	$id   = lead_find_existing( $lead['email'], $test );
	if ( $id ) { // already a lead (an industry tour or download): record the network operator inquiry as activity, not a second lead.
		lead_add_activity( $id, OPERATOR_LABEL, OPERATOR_DETAIL );
		foreach ( array( 'linkedin', 'region', 'background' ) as $k ) {
			if ( '' !== $lead[ $k ] && ! get_post_meta( $id, 'ph_lead_' . $k, true ) ) {
				update_post_meta( $id, 'ph_lead_' . $k, $lead[ $k ] );
			}
		}
	} else {
		$id = wp_insert_post( array( 'post_type' => 'ph_lead', 'post_status' => 'private', 'post_title' => $lead['name'] . ' / ' . OPERATOR_LABEL ) );
		if ( $id && ! is_wp_error( $id ) ) {
			foreach ( $lead as $k => $v ) {
				update_post_meta( $id, 'ph_lead_' . $k, $v );
			}
			update_post_meta( $id, 'ph_lead_source', OPERATOR_SOURCE );
			update_post_meta( $id, 'ph_lead_source_label', OPERATOR_LABEL );
			update_post_meta( $id, 'ph_lead_consent', 1 );
			update_post_meta( $id, 'ph_lead_page', OPERATOR_PATH );
			if ( $test ) {
				update_post_meta( $id, 'ph_lead_test', '1' );
			}
			lead_add_activity( $id, OPERATOR_LABEL, OPERATOR_DETAIL );
		} else {
			$id = 0;
		}
	}
	do_action( 'ph_lead_captured', array(
		'company'          => $lead['name'], // kept for the console's ingest; leadType "operator" marks it as an individual, so it is ignored.
		'company_industry' => OPERATOR_LABEL,
		'industry'         => OPERATOR_SOURCE,
		'contact_name'     => $lead['name'],
		'name'             => $lead['name'],
		'email'            => $lead['email'],
		'linkedin'         => $lead['linkedin'],
		'countries'        => $lead['region'],
		'job_title'        => $lead['background'],
		'region'           => $lead['region'],
		'background'       => $lead['background'],
		'lead_type'        => OPERATOR_SOURCE,
		'source'           => OPERATOR_SOURCE,
		'source_label'     => OPERATOR_LABEL,
		'source_detail'    => OPERATOR_DETAIL,
		'consent'          => true,
		'page'             => OPERATOR_PATH,
		'test'             => $test,
		'post_id'          => (int) $id,
	) );
	if ( ! $test ) {
		wp_mail( get_option( 'admin_email' ), 'New network operator inquiry: ' . $lead['name'], "Name: {$lead['name']}\nEmail: {$lead['email']}\nLinkedIn: {$lead['linkedin']}\nWhere they plan to operate: {$lead['region']}\nBackground: {$lead['background']}\nPage: " . OPERATOR_PATH );
	}
	return array( 200, array( 'ok' => true ) );
}

/* ---------- Hooks ---------- */

if ( function_exists( 'add_action' ) && ! defined( 'PH_OPERATOR_TEST' ) ) {
	add_action( 'init', __NAMESPACE__ . '\\operator_init', 25 );

	add_shortcode( OPERATOR_SHORTCODE, function () {
		return operator_html();
	} );

	add_action( 'wp_enqueue_scripts', function () {
		if ( ! operator_is_page() ) {
			return;
		}
		$ver = PH_INDUSTRY_ENHANCEMENTS_ASSETS_VERSION_10063;
		wp_enqueue_style( 'ph-operator-10063', angie_cs_get_snippet_asset_url( __FILE__, 'operator.css' ), array(), $ver );
		wp_enqueue_script( 'ph-operator-10063', angie_cs_get_snippet_asset_url( __FILE__, 'operator.js' ), array(), $ver, true );
		wp_add_inline_script( 'ph-operator-10063', 'window.PH_OPERATOR = ' . wp_json_encode( array( 'endpoint' => '/wp-json/ph-site/v1/operator-lead', 'tour' => OPERATOR_TOUR_PATH ) ) . ';', 'before' );
	} );

	add_filter( 'wp_robots', __NAMESPACE__ . '\\operator_robots', 999 );
	add_filter( 'pre_get_document_title', __NAMESPACE__ . '\\operator_document_title', 999 );
	add_filter( 'seopress_titles_title', __NAMESPACE__ . '\\operator_document_title', 999 );
	add_action( 'template_redirect', function () {
		if ( operator_is_page() && ! operator_is_live() && ! headers_sent() ) {
			header( 'X-Robots-Tag: noindex' );
		}
	}, 1 );
	add_filter( 'wp_sitemaps_posts_query_args', __NAMESPACE__ . '\\operator_sitemap_args', 99 );
	add_filter( 'seopress_sitemaps_single_query', __NAMESPACE__ . '\\operator_sitemap_args', 99 );
	add_filter( 'wp_nav_menu_objects', function ( $items ) {
		return operator_menu_objects( $items, operator_is_page(), operator_is_live() );
	}, 20 );
	add_filter( 'nav_menu_link_attributes', __NAMESPACE__ . '\\operator_menu_link_atts', 20, 2 );

	add_action( 'rest_api_init', function () {
		register_rest_route( 'ph-site/v1', '/operator-lead', array(
			'methods'             => 'POST',
			'permission_callback' => '__return_true',
			'callback'            => function ( \WP_REST_Request $req ) {
				$b = $req->get_json_params();
				list( $status, $out ) = operator_handle( is_array( $b ) ? $b : array() );
				return new \WP_REST_Response( $out, $status );
			},
		) );
	} );
}
