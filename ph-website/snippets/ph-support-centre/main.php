<?php
/**
 * PH Support Centre: the native WordPress Support Centre at /support-centre/.
 *
 * Help articles stay mastered in the PH Agent Console (FAQ Management). This snippet:
 * - registers the "Help article" content type and the Help category taxonomy (top-level categories, child folders);
 * - syncs the console's public export (index.json plus changed article bodies) into it hourly, sanitising bodies
 *   against the Help Centre allow-list and rewriting links between articles to the new URLs;
 * - renders the front, category, article and search pages server-side with the approved Help Centre markup and styles,
 *   inside the site's own header and footer;
 * - adds JSON-LD, markdown twins (?format=md), the Support Centre section of /llms.txt and the search index endpoint.
 *
 * Until LIVE is true only signed-in editors see it; visitors keep today's /support-centre/ page.
 */

namespace AngieSnippets\PhSupportCentre_10156;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const VER          = '1.4.2';
const SYNC_VER     = '2';
const HELP_API     = 'https://backlog-tracker-e4ed2.web.app/help-api';
const LIVE         = true;
const PAGE_ID      = 2780;
const BASE         = 'support-centre';
const PT           = 'ph_help_article';
const TAX          = 'ph_help_category';
const SOURCES      = [ HELP_API . '/data/', 'https://raw.githubusercontent.com/offline2online/rob_ph_demos/main/faq/data/', 'https://help.personalisationhub.com/data/' ];
const START        = 'faq-art-new-customer-journey';
const BATCH        = 45;
const SITE_NAME    = 'Personalisation Hub Support Centre';
const PROTOCOLS    = [ 'http', 'https', 'mailto', 'tel' ];
const IFRAME_HOSTS = [ 'www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com' ];
const DOC_TYPES    = [ 'faq' => 'FAQ', 'how-to' => 'How-to guide', 'reference' => 'Reference', 'explanation' => 'Explanation' ];
const NON_TOPIC    = [ 'related', 'next step' ];
const NON_STEP     = [ 'related', 'next step', 'before you begin', 'troubleshooting', 'verify it worked', 'what you need' ];
const ICON_ALIASES = [ 'queue' => 'groups', 'people' => 'groups', 'list' => 'menu_book', 'integration' => 'integration_instructions' ];
const ICONS        = [
	'rocket_launch' => 'm187-551 106 45q18-36 38.5-71t43.5-67l-79-16-109 109Zm154 81 133 133q57-26 107-59t81-64q81-81 119-166t41-192q-107 3-192 41T464-658q-31 31-64 81t-59 107Zm229-96q-20-20-20-49.5t20-49.5q20-20 49.5-20t49.5 20q20 20 20 49.5T669-566q-20 20-49.5 20T570-566Zm-15 383 109-109-16-79q-32 23-67 43.5T510-289l45 106Zm326-694q9 136-34 248T705-418l-2 2-2 2 22 110q3 15-1.5 29T706-250L535-78l-85-198-170-170-198-85 172-171q11-11 25-15.5t29-1.5l110 22q1-1 2-1.5t2-1.5q99-99 211-142.5T881-877ZM149-325q35-35 85.5-35.5T320-326q35 35 34.5 85.5T319-155q-26 26-80.5 43T75-80q15-109 31.5-164t42.5-81Zm42 43q-14 15-25 47t-19 82q50-8 82-19t47-25q19-17 19.5-42.5T278-284q-19-18-44.5-17.5T191-282Z',
	'install_desktop' => 'M330-120v-80H140q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h360v60H140v520h680v-140h60v140q0 24-18 42t-42 18H630v80H330Zm350-294L494-600l42-42 114 114v-312h60v312l114-114 42 42-186 186Z',
	'manage_accounts' => 'M400-485q-66 0-108-42t-42-108q0-66 42-108t108-42q66 0 108 42t42 108q0 66-42 108t-108 42ZM80-164v-94q0-35 17.5-63t50.5-43q72-32 133.5-46T400-424h23q-6 14-9 27.5t-5 32.5h-9q-58 0-113.5 12.5T172-310q-16 8-24 22.5t-8 29.5v34h269q5 18 12 32.5t17 27.5H80Zm587 44-10-66q-17-5-34.5-14.5T593-222l-55 12-25-42 47-44q-2-9-2-25t2-25l-47-44 25-42 55 12q12-12 29.5-21.5T657-456l10-66h54l10 66q17 5 34.5 14.5T795-420l55-12 25 42-47 44q2 9 2 25t-2 25l47 44-25 42-55-12q-12 12-29.5 21.5T731-186l-10 66h-54Zm27-121q36 0 58-22t22-58q0-36-22-58t-58-22q-36 0-58 22t-22 58q0 36 22 58t58 22ZM400-545q39 0 64.5-25.5T490-635q0-39-25.5-64.5T400-725q-39 0-64.5 25.5T310-635q0 39 25.5 64.5T400-545Zm0-90Zm9 411Z',
	'storefront' => 'M840-519v339q0 24-18 42t-42 18H179q-24 0-42-18t-18-42v-339q-28-24-37-59t2-70l43-135q8-27 28-42t46-15h553q28 0 49 15.5t29 41.5l44 135q11 35 1.5 70T840-519Zm-270-31q29 0 49-19t16-46l-25-165H510v165q0 26 17 45.5t43 19.5Zm-187 0q28 0 47.5-19t19.5-46v-165H350l-25 165q-4 26 14 45.5t44 19.5Zm-182 0q24 0 41.5-16.5T263-607l26-173H189l-46 146q-10 31 8 57.5t50 26.5Zm557 0q32 0 50.5-26t8.5-58l-46-146H671l26 173q3 24 20.5 40.5T758-550ZM179-180h601v-311q1 1-6.5 1H758q-25 0-47.5-10.5T666-533q-16 20-40 31.5T573-490q-30 0-51.5-8.5T480-527q-15 18-38 27.5t-52 9.5q-31 0-55-11t-41-32q-24 21-47 32t-46 11h-13.5q-6.5 0-8.5-1v311Zm601 0H179h601Z',
	'devices' => 'M80-160v-90h80v-490q0-24.75 17.625-42.375T220-800h620v60H220v490h240v90H80Zm470 0q-12.75 0-21.375-8.625T520-190v-460q0-12.75 8.625-21.375T550-680h300q12.75 0 21.375 8.625T880-650v460q0 12.75-8.625 21.375T850-160H550Zm30-90h240v-370H580v370Zm0 0h240-240Z',
	'tv' => 'M330-120v-80H140q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H630v80H330ZM140-260h680v-520H140v520Zm0 0v-520 520Z',
	'psychology' => 'M240-80v-172q-57-52-88.5-121.5T120-520q0-150 105-255t255-105q125 0 221.5 73.5T827-615l55 218q4 14-5 25.5T853-360h-93v140q0 24.75-17.625 42.375T700-160H600v80h-60v-140h160v-200h114l-45-180q-24-97-105-158.5T480-820q-125 0-212.5 86.5T180-522.46q0 64.417 26.324 122.392Q232.649-342.092 281-297l19 18v199h-60Zm257-370Zm-48 76h60l3-44q12-2 22.472-8.462Q544.944-432.923 553-441l42 14 28-48-30-24q5-14 5-29t-5-29l30-24-28-48-42 14q-8.333-7.692-19.167-13.846Q523-635 512-638l-3-44h-60l-3 44q-11 3-21.833 9.154Q413.333-622.692 405-615l-42-14-28 48 30 24q-5 14-5 29t5 29l-30 24 28 48 42-14q8.056 8.077 18.528 14.538Q434-420 446-418l3 44Zm30.118-84Q450-458 429.5-478.382q-20.5-20.383-20.5-49.5Q409-557 429.382-577.5q20.383-20.5 49.5-20.5Q508-598 528.5-577.618q20.5 20.383 20.5 49.5Q549-499 528.618-478.5q-20.383 20.5-49.5 20.5Z',
	'smartphone' => 'M260-40q-24 0-42-18t-18-42v-760q0-24 18-42t42-18h440q24 0 42 18t18 42v760q0 24-18 42t-42 18H260Zm0-90v30h440v-30H260Zm0-60h440v-580H260v580Zm0-640h440v-30H260v30Zm0 0v-30 30Zm0 700v30-30Z',
	'groups' => 'M0-240v-53q0-38.567 41.5-62.784Q83-380 150.376-380q12.165 0 23.395.5Q185-379 196-377.348q-8 17.348-12 35.165T180-305v65H0Zm240 0v-65q0-32 17.5-58.5T307-410q32-20 76.5-30t96.5-10q53 0 97.5 10t76.5 30q32 20 49 46.5t17 58.5v65H240Zm540 0v-65q0-19.861-3.5-37.431Q773-360 765-377.273q11-1.727 22.171-2.227 11.172-.5 22.829-.5 67.5 0 108.75 23.768T960-293v53H780Zm-480-60h360v-6q0-37-50.5-60.5T480-390q-79 0-129.5 23.5T300-305v5ZM149.567-410Q121-410 100.5-430.562 80-451.125 80-480q0-29 20.562-49.5Q121.125-550 150-550q29 0 49.5 20.5t20.5 49.933Q220-451 199.5-430.5T149.567-410Zm660 0Q781-410 760.5-430.562 740-451.125 740-480q0-29 20.562-49.5Q781.125-550 810-550q29 0 49.5 20.5t20.5 49.933Q880-451 859.5-430.5T809.567-410ZM480-480q-50 0-85-35t-35-85q0-51 35-85.5t85-34.5q51 0 85.5 34.5T600-600q0 50-34.5 85T480-480Zm.351-60Q506-540 523-557.351t17-43Q540-626 522.851-643t-42.5-17Q455-660 437.5-642.851t-17.5 42.5Q420-575 437.351-557.5t43 17.5ZM480-300Zm0-300Z',
	'event' => 'M596.817-220Q556-220 528-248.183q-28-28.183-28-69T528.183-386q28.183-28 69-28T666-385.817q28 28.183 28 69T665.817-248q-28.183 28-69 28ZM180-80q-24 0-42-18t-18-42v-620q0-24 18-42t42-18h65v-60h65v60h340v-60h65v60h65q24 0 42 18t18 42v620q0 24-18 42t-42 18H180Zm0-60h600v-430H180v430Zm0-490h600v-130H180v130Zm0 0v-130 130Z',
	'integration_instructions' => 'm384-335 43-43-101-102 101-101-43-43-144 144.5L384-335Zm192 0 145-145-144-144-43 43 101 101-102 102 43 43ZM180-120q-24.75 0-42.375-17.625T120-180v-600q0-24.75 17.625-42.375T180-840h205q5-35 32-57.5t63-22.5q36 0 63 22.5t32 57.5h205q24.75 0 42.375 17.625T840-780v600q0 24.75-17.625 42.375T780-120H180Zm0-60h600v-600H180v600Zm300-617q14 0 24.5-10.5T515-832q0-14-10.5-24.5T480-867q-14 0-24.5 10.5T445-832q0 14 10.5 24.5T480-797ZM180-180v-600 600Z',
	'build' => 'M705-128 447-388q-23 8-46 13t-47 5q-97.083 0-165.042-67.667Q121-505.333 121-602q0-31 8.158-60.388Q137.316-691.777 152-718l145 145 92-86-149-149q25.915-15.158 54.957-23.579Q324-840 354-840q99.167 0 168.583 69.417Q592-701.167 592-602q0 24-5 47t-13 46l259 258q11 10.957 11 26.478Q844-209 833-198l-76 70q-10.696 11-25.848 11T705-128Zm28-57 40-40-273-273q16-21 24-49.5t8-54.5q0-75-55.5-127T350-782l102 104q9 9 8.5 21.5T451-635L318-510q-9.273 8-21.636 8Q284-502 276-510l-98-97q3 77 54.668 127T354-430q25 0 53-8t49-24l277 277ZM476-484Z',
	'help' => 'M484-247q16 0 27-11t11-27q0-16-11-27t-27-11q-16 0-27 11t-11 27q0 16 11 27t27 11Zm-35-146h59q0-26 6.5-47.5T555-490q31-26 44-51t13-55q0-53-34.5-85T486-713q-49 0-86.5 24.5T345-621l53 20q11-28 33-43.5t52-15.5q34 0 55 18.5t21 47.5q0 22-13 41.5T508-512q-30 26-44.5 51.5T449-393Zm31 313q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-156t86-127Q252-817 325-848.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 82-31.5 155T763-197.5q-54 54.5-127 86T480-80Zm0-60q142 0 241-99.5T820-480q0-142-99-241t-241-99q-141 0-240.5 99T140-480q0 141 99.5 240.5T480-140Zm0-340Z',
	'folder' => 'M140-160q-24 0-42-18.5T80-220v-520q0-23 18-41.5t42-18.5h281l60 60h339q23 0 41.5 18.5T880-680v460q0 23-18.5 41.5T820-160H140Zm0-60h680v-460H456l-60-60H140v520Zm0 0v-520 520Z',
	'search' => 'M796-121 533-384q-30 26-69.959 40.5T378-329q-108.162 0-183.081-75Q120-479 120-585t75-181q75-75 181.5-75t181 75Q632-691 632-584.85 632-542 618-502q-14 40-42 75l264 262-44 44ZM377-389q81.25 0 138.125-57.5T572-585q0-81-56.875-138.5T377-781q-82.083 0-139.542 57.5Q180-666 180-585t57.458 138.5Q294.917-389 377-389Z',
	'arrow_back' => 'm274-450 248 248-42 42-320-320 320-320 42 42-248 248h526v60H274Z',
	'arrow_forward' => 'M686-450H160v-60h526L438-758l42-42 320 320-320 320-42-42 248-248Z',
	'menu_book' => 'M560-574v-48q33-14 67.5-21t72.5-7q26 0 51 4t49 10v44q-24-9-48.5-13.5T700-610q-38 0-73 9.5T560-574Zm0 220v-49q33-13.5 67.5-20.25T700-430q26 0 51 4t49 10v44q-24-9-48.5-13.5T700-390q-38 0-73 9t-67 27Zm0-110v-48q33-14 67.5-21t72.5-7q26 0 51 4t49 10v44q-24-9-48.5-13.5T700-500q-38 0-73 9.5T560-464ZM248-300q53.566 0 104.283 12.5T452-250v-427q-45-30-97.619-46.5Q301.763-740 248-740q-38 0-74.5 9.5T100-707v434q31-14 70.5-20.5T248-300Zm264 50q50-25 98-37.5T712-300q38 0 78.5 6t69.5 16v-429q-34-17-71.822-25-37.823-8-76.178-8-54 0-104.5 16.5T512-677v427Zm-30 90q-51-38-111-58.5T248-239q-36.537 0-71.768 9Q141-221 106-208q-23.1 11-44.55-3Q40-225 40-251v-463q0-15 7-27.5T68-761q42-20 87.395-29.5Q200.789-800 248-800q63 0 122.5 17T482-731q51-35 109.5-52T712-800q46.868 0 91.934 9.5Q849-781 891-761q14 7 21.5 19.5T920-714v463q0 27.894-22.5 42.447Q875-194 853-208q-34-14-69.232-22.5Q748.537-239 712-239q-63 0-121 21t-109 58ZM276-489Z',
	'table_chart' => 'M820-121H180q-24 0-42-18t-18-42v-599q0-24 18-42t42-18h640q24 0 42 18t18 42v599q0 24-18 42t-42 18ZM180-639h640v-141H180v141Zm150 60H180v398h150v-398Zm340 0v398h150v-398H670Zm-60 0H390v398h220v-398Z',
	'description' => 'M319-250h322v-60H319v60Zm0-170h322v-60H319v60ZM220-80q-24 0-42-18t-18-42v-680q0-24 18-42t42-18h361l219 219v521q0 24-18 42t-42 18H220Zm331-554v-186H220v680h520v-494H551ZM220-820v186-186 680-680Z',
	'chevron_right' => 'M530-481 332-679l43-43 241 241-241 241-43-43 198-198Z',
	'open_in_new' => 'M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h279v60H180v600h600v-279h60v279q0 24-18 42t-42 18H180Zm202-219-42-43 398-398H519v-60h321v321h-60v-218L382-339Z',
	'content_copy' => 'M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z',
	'check' => 'M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z',
	'expand_more' => 'M480-345 240-585l56-56 184 184 184-184 56 56-240 240Z',
	'expand_less' => 'm296-345-56-56 240-240 240 240-56 56-184-184-184 184Z',
];

/* ---------- access ---------- */
function can_preview() {
	return current_user_can( 'edit_posts' );
}

function active() {
	return LIVE || can_preview();
}

function safe_id( $id ) {
	return is_string( $id ) && preg_match( '/^[A-Za-z0-9_-]{1,120}$/', $id );
}

/* ---------- content type, taxonomy, fields, routes ---------- */
add_action( 'init', function () {
	register_taxonomy( TAX, PT, [
		'labels'            => [ 'name' => 'Help categories', 'singular_name' => 'Help category', 'menu_name' => 'Categories and folders', 'parent_item' => 'Parent category' ],
		'description'       => 'Help Centre categories (top level) and their folders (children), synced from the PH Agent Console.',
		'hierarchical'      => true,
		'public'            => true,
		'show_ui'           => true,
		'show_admin_column' => true,
		'show_in_rest'      => true,
		'rest_base'         => 'help-categories',
		'show_tagcloud'     => false,
		'rewrite'           => false,
		'query_var'         => 'ph_help_cat',
	] );
	register_post_type( PT, [
		'labels'              => [ 'name' => 'Help articles', 'singular_name' => 'Help article', 'menu_name' => 'Support Centre', 'all_items' => 'Help articles', 'edit_item' => 'Edit help article', 'view_item' => 'View help article', 'search_items' => 'Search help articles' ],
		'description'         => 'Support Centre help articles. Mastered in the PH Agent Console; synced here, never edited here.',
		'public'              => true,
		'exclude_from_search' => true,
		'show_in_rest'        => true,
		'rest_base'           => 'help-articles',
		'has_archive'         => false,
		'rewrite'             => false,
		'query_var'           => 'ph_help_article',
		'menu_icon'           => 'dashicons-sos',
		'menu_position'       => 21,
		'supports'            => [ 'title', 'editor', 'excerpt', 'custom-fields', 'page-attributes', 'revisions' ],
		'taxonomies'          => [ TAX ],
	] );
	$auth = function () {
		return current_user_can( 'edit_posts' );
	};
	foreach ( [ 'ph_help_id', 'ph_help_doctype', 'ph_help_direct_answer', 'ph_help_release_from', 'ph_help_release_to', 'ph_help_programme', 'ph_help_project', 'ph_help_section_picker_label', 'ph_help_updated', 'ph_help_hash', 'ph_help_sig', 'ph_help_version', 'ph_help_article_type' ] as $k ) {
		register_post_meta( PT, $k, [ 'type' => 'string', 'single' => true, 'show_in_rest' => true, 'auth_callback' => $auth ] );
	}
	foreach ( [ 'ph_help_keywords', 'ph_help_questions' ] as $k ) {
		register_post_meta( PT, $k, [ 'type' => 'array', 'single' => true, 'auth_callback' => $auth, 'show_in_rest' => [ 'schema' => [ 'type' => 'array', 'items' => [ 'type' => 'string' ] ] ] ] );
	}
	register_post_meta( PT, 'ph_help_section_picker', [ 'type' => 'boolean', 'single' => true, 'show_in_rest' => true, 'auth_callback' => $auth ] );
	register_post_meta( PT, 'ph_help_pos', [ 'type' => 'integer', 'single' => true, 'show_in_rest' => true, 'auth_callback' => $auth ] );
	foreach ( [ 'ph_help_id' => 'string', 'ph_help_icon' => 'string', 'ph_help_order' => 'integer' ] as $k => $t ) {
		register_term_meta( TAX, $k, [ 'type' => $t, 'single' => true, 'show_in_rest' => true, 'auth_callback' => $auth ] );
	}
	add_rewrite_rule( '^' . BASE . '/search/?$', 'index.php?pagename=' . BASE . '&ph_help_view=search', 'top' );
	add_rewrite_rule( '^' . BASE . '/([^/]+)/([^/]+)/?$', 'index.php?ph_help_article=$matches[2]&ph_help_catpath=$matches[1]', 'top' );
	add_rewrite_rule( '^' . BASE . '/([^/]+)/?$', 'index.php?ph_help_cat=$matches[1]', 'top' );
	if ( ! wp_next_scheduled( 'ph_sc_sync' ) ) {
		wp_schedule_event( time() + 120, 'hourly', 'ph_sc_sync' );
	}
} );

add_action( 'wp_loaded', function () {
	if ( get_option( 'ph_sc_rw' ) !== VER ) {
		flush_rewrite_rules( false );
		update_option( 'ph_sc_rw', VER );
	}
} );

add_filter( 'query_vars', function ( $v ) {
	$v[] = 'ph_help_view';
	$v[] = 'ph_help_catpath';
	return $v;
} );

add_action( 'ph_sc_sync', function () {
	sync( false );
} );

add_filter( 'use_block_editor_for_post_type', function ( $use, $type ) {
	return PT === $type ? false : $use;
}, 10, 2 );

add_action( 'admin_notices', function () {
	$s = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	if ( ! $s || ( PT !== $s->post_type && TAX !== $s->taxonomy ) ) {
		return;
	}
	$st = (array) get_option( 'ph_sc_state', [] );
	echo '<div class="notice notice-info"><p><strong>Help articles are managed in the PH Agent Console.</strong> This content is synced from the console every hour, and the next sync overwrites any change made here. Last sync: ' . esc_html( ! empty( $st['at'] ) ? human_time_diff( (int) $st['at'] ) . ' ago' : 'not yet' ) . '.</p></div>';
} );

/* ---------- URLs ---------- */
function base_url( $path = '' ) {
	return home_url( '/' . BASE . '/' . $path );
}

function md_url( $url ) {
	return add_query_arg( 'format', 'md', $url );
}

add_filter( 'post_type_link', function ( $link, $post ) {
	if ( PT !== $post->post_type ) {
		return $link;
	}
	$terms = get_the_terms( $post, TAX );
	$top   = null;
	if ( $terms && ! is_wp_error( $terms ) ) {
		$top = $terms[0];
		while ( $top->parent ) {
			$p = get_term( $top->parent, TAX );
			if ( ! $p || is_wp_error( $p ) ) {
				break;
			}
			$top = $p;
		}
	}
	return base_url( ( $top ? $top->slug . '/' : '' ) . $post->post_name . '/' );
}, 10, 2 );

add_filter( 'term_link', function ( $url, $term, $tax ) {
	if ( TAX !== $tax ) {
		return $url;
	}
	if ( $term->parent ) {
		$p = get_term( $term->parent, TAX );
		return ( $p && ! is_wp_error( $p ) ) ? base_url( $p->slug . '/#' . $term->slug ) : base_url();
	}
	return base_url( $term->slug . '/' );
}, 10, 3 );

/* ---------- catalogue (cached; cleared on sync and on edits) ---------- */
function flush_cache() {
	delete_transient( 'ph_sc_cat' );
}
add_action( 'save_post_' . PT, __NAMESPACE__ . '\flush_cache' );
add_action( 'deleted_post', __NAMESPACE__ . '\flush_cache' );
foreach ( [ 'created_' . TAX, 'edited_' . TAX, 'delete_' . TAX ] as $h ) {
	add_action( $h, __NAMESPACE__ . '\flush_cache' );
}

function decode( $s ) {
	return html_entity_decode( (string) $s, ENT_QUOTES, 'UTF-8' );
}

function build_catalogue() {
	$cats  = [];
	$terms = get_terms( [ 'taxonomy' => TAX, 'hide_empty' => false ] );
	foreach ( is_array( $terms ) ? $terms : [] as $t ) {
		$cats[ $t->term_id ] = [
			'id'     => $t->term_id,
			'cid'    => (string) get_term_meta( $t->term_id, 'ph_help_id', true ),
			'name'   => decode( $t->name ),
			'slug'   => $t->slug,
			'desc'   => decode( $t->description ),
			'parent' => (int) $t->parent,
			'icon'   => (string) get_term_meta( $t->term_id, 'ph_help_icon', true ),
			'order'  => (int) get_term_meta( $t->term_id, 'ph_help_order', true ),
		];
	}
	uasort( $cats, function ( $a, $b ) {
		return $a['order'] <=> $b['order'] ?: $a['id'] <=> $b['id'];
	} );
	$arts  = [];
	$posts = get_posts( [ 'post_type' => PT, 'post_status' => 'publish', 'numberposts' => -1, 'orderby' => 'menu_order', 'order' => 'ASC', 'no_found_rows' => true, 'suppress_filters' => true ] );
	foreach ( $posts as $p ) {
		$t  = get_the_terms( $p, TAX );
		$m  = function ( $k ) use ( $p ) {
			return get_post_meta( $p->ID, $k, true );
		};
		$kw = $m( 'ph_help_keywords' );
		$qs = $m( 'ph_help_questions' );
		$arts[ $p->ID ] = [
			'id'      => $p->ID,
			'cid'     => (string) $m( 'ph_help_id' ),
			'cat'     => ( $t && ! is_wp_error( $t ) ) ? (int) $t[0]->term_id : 0,
			'order'   => (int) $p->menu_order,
			'pos'     => (int) $m( 'ph_help_pos' ),
			'title'   => decode( $p->post_title ),
			'slug'    => $p->post_name,
			'summary' => decode( $p->post_excerpt ),
			'type'    => (string) $m( 'ph_help_doctype' ),
			'kw'      => is_array( $kw ) ? array_values( array_map( 'strval', $kw ) ) : [],
			'q'       => is_array( $qs ) ? array_values( array_map( 'strval', $qs ) ) : [],
			'from'    => (string) $m( 'ph_help_release_from' ),
			'to'      => (string) $m( 'ph_help_release_to' ),
			'updated' => (string) $m( 'ph_help_updated' ) ?: get_post_modified_time( 'c', true, $p ),
			'answer'  => (string) $m( 'ph_help_direct_answer' ),
			'picker'  => (bool) $m( 'ph_help_section_picker' ),
			'plabel'  => (string) $m( 'ph_help_section_picker_label' ),
			'atype'   => (string) $m( 'ph_help_article_type' ),
			'hash'    => (string) $m( 'ph_help_hash' ),
		];
	}
	uasort( $arts, function ( $a, $b ) {
		return $a['pos'] <=> $b['pos'] ?: $a['order'] <=> $b['order'] ?: $a['id'] <=> $b['id'];
	} );
	return [ 'v' => VER, 'cats' => $cats, 'arts' => $arts ];
}

function catalogue() {
	static $c = null;
	if ( null === $c ) {
		$c = get_transient( 'ph_sc_cat' );
		if ( ! is_array( $c ) || ( $c['v'] ?? '' ) !== VER ) {
			$c = build_catalogue();
			set_transient( 'ph_sc_cat', $c, DAY_IN_SECONDS );
		}
	}
	return $c;
}

function cats() {
	return catalogue()['cats'];
}

/* ---------- releases (same range check as the Help Centre and the console) ---------- */
function releases() {
	$r = get_option( 'ph_sc_releases', [] );
	return is_array( $r ) ? $r : [];
}

function target_release() {
	static $t = false;
	if ( false !== $t ) {
		return $t;
	}
	$t    = null;
	$rels = releases();
	if ( ! $rels ) {
		return $t;
	}
	$want = isset( $_GET['release'] ) ? sanitize_text_field( wp_unslash( $_GET['release'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
	if ( '' !== $want ) {
		foreach ( $rels as $r ) {
			if ( $r['id'] === $want || ( '' !== $r['version'] && $r['version'] === $want ) ) {
				return $t = $r;
			}
		}
	}
	$live = array_values( array_filter( $rels, function ( $r ) {
		return 'live' === $r['status'];
	} ) );
	usort( $live, function ( $a, $b ) {
		return $b['order'] <=> $a['order'];
	} );
	return $t = ( $live[0] ?? null );
}

function in_release( $a ) {
	$t = target_release();
	if ( ! $t ) {
		return true;
	}
	$by = [];
	foreach ( releases() as $r ) {
		$by[ $r['id'] ] = $r;
	}
	if ( $a['from'] ) {
		$r = $by[ $a['from'] ] ?? null;
		if ( ! $r || ! ( $r['order'] <= $t['order'] ) ) {
			return false;
		}
	}
	if ( $a['to'] ) {
		$r = $by[ $a['to'] ] ?? null;
		if ( ! $r || ! ( $t['order'] < $r['order'] ) ) {
			return false;
		}
	}
	return true;
}

/* ---------- reading order helpers (ports of faq-data.js) ---------- */
function visible() {
	static $v = null;
	if ( null === $v ) {
		$v = array_filter( catalogue()['arts'], __NAMESPACE__ . '\in_release' );
	}
	return $v;
}

function top_cats() {
	return array_values( array_filter( cats(), function ( $c ) {
		return ! $c['parent'];
	} ) );
}

function sub_cats( $pid ) {
	return array_values( array_filter( cats(), function ( $c ) use ( $pid ) {
		return $c['parent'] === $pid;
	} ) );
}

function arts_in( $tid ) {
	$out = array_values( array_filter( visible(), function ( $a ) use ( $tid ) {
		return $a['cat'] === $tid;
	} ) );
	usort( $out, function ( $a, $b ) {
		return $a['order'] <=> $b['order'] ?: $a['pos'] <=> $b['pos'];
	} );
	return $out;
}

function arts_under( $tid ) {
	$out = arts_in( $tid );
	foreach ( sub_cats( $tid ) as $s ) {
		$out = array_merge( $out, arts_in( $s['id'] ) );
	}
	return $out;
}

function parent_cat( $tid ) {
	$c = cats()[ $tid ] ?? null;
	if ( ! $c ) {
		return null;
	}
	return $c['parent'] ? ( cats()[ $c['parent'] ] ?? $c ) : $c;
}

function art_url( $a ) {
	$top = parent_cat( $a['cat'] );
	return base_url( ( $top ? $top['slug'] . '/' : '' ) . $a['slug'] . '/' );
}

function cat_url( $c ) {
	if ( $c['parent'] ) {
		$p = cats()[ $c['parent'] ] ?? null;
		return $p ? base_url( $p['slug'] . '/#' . $c['slug'] ) : base_url();
	}
	return base_url( $c['slug'] . '/' );
}

function art_by_cid( $cid ) {
	foreach ( visible() as $a ) {
		if ( $a['cid'] === $cid ) {
			return $a;
		}
	}
	return null;
}

function cat_by_cid( $cid ) {
	foreach ( cats() as $c ) {
		if ( $c['cid'] === $cid ) {
			return $c;
		}
	}
	return null;
}

function doc_label( $a ) {
	return DOC_TYPES[ $a['type'] ] ?? DOC_TYPES['faq'];
}

/* ---------- search: the Help Centre's scoring, plus question variants ---------- */
/* Question words and filler ("how do I add a store") are dropped so a question finds the same articles as its
   keywords ("add store"). If a query is nothing but such words, it is searched as typed. */
const STOPWORDS = [ 'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'about', 'into', 'is', 'are', 'am', 'be', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'how', 'what', 'when', 'where', 'which', 'who', 'why', 'i', 'my', 'me', 'we', 'our', 'us', 'you', 'your', 'it', 'its', 'this', 'that', 'these', 'those', 'there', 'please' ];

function search_terms( $q ) {
	$terms = array_values( array_filter( array_map( function ( $t ) {
		return trim( $t, " \t\n\r\0\x0B?!.,;:\"'()" );
	}, preg_split( '/\s+/u', mb_strtolower( (string) $q ) ) ), function ( $t ) {
		return mb_strlen( $t ) > 1;
	} ) );
	$kept  = array_values( array_filter( $terms, function ( $t ) {
		return ! in_array( $t, STOPWORDS, true );
	} ) );
	return $kept ? $kept : $terms;
}

function search_articles( $arts, $q ) {
	$terms = search_terms( $q );
	if ( ! $terms ) {
		return [];
	}
	$scored = [];
	$i      = 0;
	foreach ( $arts as $a ) {
		$i++;
		$title = mb_strtolower( $a['title'] );
		$sum   = mb_strtolower( $a['summary'] );
		$kws   = array_map( 'mb_strtolower', $a['kw'] );
		$qs    = array_map( 'mb_strtolower', $a['q'] );
		$score = 0;
		$all   = true;
		foreach ( $terms as $t ) {
			$s = 0;
			if ( str_contains( $title, $t ) ) {
				$s += str_starts_with( $title, $t ) ? 12 : 8;
			}
			foreach ( $kws as $k ) {
				if ( str_contains( $k, $t ) ) {
					$s += 5;
					break;
				}
			}
			foreach ( $qs as $k ) {
				if ( str_contains( $k, $t ) ) {
					$s += 4;
					break;
				}
			}
			if ( str_contains( $sum, $t ) ) {
				$s += 2;
			}
			if ( ! $s ) {
				$all = false;
				break;
			}
			$score += $s;
		}
		if ( $all ) {
			$scored[] = [ $a, $score, $i ];
		}
	}
	usort( $scored, function ( $x, $y ) {
		return $y[1] <=> $x[1] ?: $x[0]['order'] <=> $y[0]['order'] ?: $x[2] <=> $y[2];
	} );
	return array_column( $scored, 0 );
}

/* ---------- body sanitising (the Help Centre's DOMPurify allow-list, server-side) ---------- */
function allowed_html() {
	$g    = [ 'class' => true, 'title' => true, 'lang' => true, 'dir' => true ];
	$tags = [ 'p', 'div', 'span', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'mark', 'small', 'sub', 'sup', 'code', 'kbd', 'abbr', 'q', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'figure', 'figcaption' ];
	$out  = [];
	foreach ( $tags as $t ) {
		$out[ $t ] = $g;
	}
	$out['a']      = $g + [ 'href' => true, 'target' => true, 'rel' => true, 'data-help-id' => true, 'data-help-cat' => true ];
	$out['img']    = $g + [ 'src' => true, 'alt' => true, 'width' => true, 'height' => true, 'loading' => true ];
	$out['ol']    += [ 'start' => true, 'type' => true, 'reversed' => true ];
	$out['th']    += [ 'colspan' => true, 'rowspan' => true, 'scope' => true ];
	$out['td']    += [ 'colspan' => true, 'rowspan' => true ];
	$out['pre']    = $g + [ 'data-copy-label' => true, 'data-collapse' => true, 'data-collapse-lines' => true, 'spellcheck' => true ];
	$out['iframe'] = [ 'src' => true, 'width' => true, 'height' => true, 'title' => true, 'allowfullscreen' => true, 'frameborder' => true, 'allow' => true, 'loading' => true, 'referrerpolicy' => true, 'sandbox' => true ];
	return $out;
}

function attrs_of( $s ) {
	$out = [];
	foreach ( wp_kses_hair( $s, PROTOCOLS ) as $k => $v ) {
		$out[ strtolower( $k ) ] = decode( $v['value'] );
	}
	return $out;
}

function tag( $name, $at ) {
	$s = '<' . $name;
	foreach ( $at as $k => $v ) {
		$s .= ' ' . $k . '="' . ( in_array( $k, [ 'href', 'src' ], true ) ? esc_url( $v, PROTOCOLS ) : esc_attr( $v ) ) . '"';
	}
	return $s . '>';
}

function fix_iframes( $html ) {
	return preg_replace_callback( '#<iframe\b([^>]*)>.*?</iframe>#is', function ( $m ) {
		$at   = attrs_of( $m[1] );
		$host = strtolower( (string) wp_parse_url( $at['src'] ?? '', PHP_URL_HOST ) );
		if ( ! in_array( $host, IFRAME_HOSTS, true ) || 'https' !== strtolower( (string) wp_parse_url( $at['src'], PHP_URL_SCHEME ) ) ) {
			return '';
		}
		$keep = array_intersect_key( $at, array_flip( [ 'src', 'width', 'height', 'title', 'allow', 'allowfullscreen', 'frameborder' ] ) );
		return tag( 'iframe', $keep + [ 'loading' => 'lazy', 'referrerpolicy' => 'strict-origin-when-cross-origin', 'sandbox' => 'allow-scripts allow-same-origin allow-presentation' ] ) . '</iframe>';
	}, $html );
}

/** Rewrites Help Centre links (article.html?id=, category.html?id=) to Support Centre URLs; external links open in a new tab. */
function fix_links( $html, callable $art, callable $cat ) {
	$own = strtolower( (string) wp_parse_url( home_url(), PHP_URL_HOST ) );
	return preg_replace_callback( '#<a\b([^>]*)>#i', function ( $m ) use ( $art, $cat, $own ) {
		$at   = attrs_of( $m[1] );
		$href = $at['href'] ?? '';
		$path = $href;
		$hash = '';
		$p    = strpos( $href, '#' );
		if ( false !== $p ) {
			$hash = substr( $href, $p );
			$path = substr( $href, 0, $p );
		}
		$aid = $at['data-help-id'] ?? '';
		$cid = $at['data-help-cat'] ?? '';
		unset( $at['data-help-id'], $at['data-help-cat'] );
		if ( ! $aid && preg_match( '#(?:^|/)article\.html\?(?:[^\#]*&)?id=([A-Za-z0-9_-]{1,120})#', $path, $x ) ) {
			$aid = $x[1];
		}
		if ( ! $aid && ! $cid && preg_match( '#(?:^|/)category\.html\?(?:[^\#]*&)?id=([A-Za-z0-9_-]{1,120})#', $path, $x ) ) {
			$cid = $x[1];
		}
		if ( $aid && safe_id( $aid ) ) {
			$u                  = $art( $aid );
			$at['href']         = $u ? $u . $hash : base_url();
			$at['data-help-id'] = $aid;
			unset( $at['target'], $at['rel'] );
		} elseif ( $cid && safe_id( $cid ) ) {
			$u                   = $cat( $cid );
			$at['href']          = $u ? $u : base_url();
			$at['data-help-cat'] = $cid;
			unset( $at['target'], $at['rel'] );
		} elseif ( preg_match( '#^https?://#i', $href ) ) {
			$host = strtolower( (string) wp_parse_url( $href, PHP_URL_HOST ) );
			if ( $host && $host !== $own ) {
				$at['target'] = '_blank';
			}
		}
		if ( '_blank' === ( $at['target'] ?? '' ) ) {
			$at['rel'] = 'noopener noreferrer';
		}
		return tag( 'a', $at );
	}, $html );
}

function legacy_md( $md ) {
	$html = '';
	$list = false;
	foreach ( preg_split( '/\r?\n/', esc_html( $md ) ) as $raw ) {
		$line = trim( $raw );
		$in   = function ( $s ) {
			return preg_replace( '/\*\*(.+?)\*\*/', '<strong>$1</strong>', $s );
		};
		if ( '' === $line ) {
			$html .= $list ? '</ul>' : '';
			$list  = false;
			continue;
		}
		if ( str_starts_with( $line, '## ' ) ) {
			$html .= ( $list ? '</ul>' : '' ) . '<h2>' . substr( $line, 3 ) . '</h2>';
			$list  = false;
			continue;
		}
		if ( str_starts_with( $line, '- ' ) ) {
			$html .= ( $list ? '' : '<ul>' ) . '<li>' . $in( substr( $line, 2 ) ) . '</li>';
			$list  = true;
			continue;
		}
		$html .= ( $list ? '</ul>' : '' ) . '<p>' . $in( $line ) . '</p>';
		$list  = false;
	}
	return $html . ( $list ? '</ul>' : '' );
}

/** Copies externally hosted images into the media library once, and points the body at the copy. */
function copy_images( $html ) {
	return preg_replace_callback( '#<img\b([^>]*)>#i', function ( $m ) {
		$at  = attrs_of( $m[1] );
		$src = $at['src'] ?? '';
		if ( ! preg_match( '#^https://#i', $src ) || str_starts_with( $src, home_url() ) ) {
			return $m[0];
		}
		$map = get_option( 'ph_sc_media', [] );
		$key = md5( $src );
		$id  = (int) ( $map[ $key ] ?? 0 );
		if ( ! $id || ! get_post( $id ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';
			$tmp = download_url( $src, 20 );
			if ( is_wp_error( $tmp ) ) {
				return $m[0];
			}
			$type = wp_get_image_mime( $tmp );
			$ext  = [ 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp' ][ $type ] ?? '';
			if ( ! $ext ) {
				wp_delete_file( $tmp );
				return $m[0];
			}
			$id = media_handle_sideload( [ 'name' => 'ph-help-' . substr( $key, 0, 12 ) . '.' . $ext, 'tmp_name' => $tmp ], 0, $at['alt'] ?? '' );
			if ( is_wp_error( $id ) ) {
				wp_delete_file( $tmp );
				return $m[0];
			}
			if ( ! empty( $at['alt'] ) ) {
				update_post_meta( $id, '_wp_attachment_image_alt', sanitize_text_field( $at['alt'] ) );
			}
			$map[ $key ] = $id;
			update_option( 'ph_sc_media', $map, false );
		}
		$url = wp_get_attachment_url( $id );
		if ( $url ) {
			$at['src'] = $url;
		}
		$at['loading'] = 'lazy';
		return tag( 'img', $at );
	}, $html );
}

function clean_body( $html, callable $art, callable $cat ) {
	$html = trim( (string) $html );
	if ( '' === $html ) {
		return '';
	}
	if ( '<' !== $html[0] ) {
		$html = legacy_md( $html );
	}
	$html = wp_kses( $html, allowed_html(), PROTOCOLS );
	$html = fix_iframes( $html );
	$html = fix_links( $html, $art, $cat );
	return copy_images( $html );
}

/* ---------- sync from the PH Agent Console export ---------- */
function fetch_json( $file, &$src = null ) {
	foreach ( SOURCES as $s ) {
		$r = wp_remote_get( $s . $file, [ 'timeout' => 15, 'headers' => [ 'Accept' => 'application/json' ] ] );
		if ( is_wp_error( $r ) || 200 !== (int) wp_remote_retrieve_response_code( $r ) ) {
			continue;
		}
		$j = json_decode( wp_remote_retrieve_body( $r ), true );
		if ( is_array( $j ) ) {
			$src = $s;
			return $j;
		}
	}
	return null;
}

function slugify( $s ) {
	return sanitize_title( str_replace( '&', ' and ', (string) $s ) );
}

function str_list( $v ) {
	return is_array( $v ) ? array_values( array_filter( array_map( function ( $x ) {
		return is_scalar( $x ) ? sanitize_text_field( (string) $x ) : '';
	}, $v ), 'strlen' ) ) : [];
}

function first( array $src, array $keys ) {
	foreach ( $keys as $k ) {
		if ( isset( $src[ $k ] ) && '' !== $src[ $k ] && null !== $src[ $k ] ) {
			return $src[ $k ];
		}
	}
	return null;
}

function set_meta( $id, $key, $val, $term = false ) {
	$old = $term ? get_term_meta( $id, $key, true ) : get_post_meta( $id, $key, true );
	if ( $old === $val || ( is_scalar( $val ) && (string) $old === (string) $val && ! is_bool( $val ) ) ) {
		return;
	}
	$term ? update_term_meta( $id, $key, $val ) : update_post_meta( $id, $key, wp_slash( $val ) );
}

function sync_terms( array $cats ) {
	usort( $cats, function ( $a, $b ) {
		return ( empty( $a['parentId'] ) ? 0 : 1 ) <=> ( empty( $b['parentId'] ) ? 0 : 1 ) ?: (int) ( $a['order'] ?? 0 ) <=> (int) ( $b['order'] ?? 0 );
	} );
	$have = [];
	$all  = get_terms( [ 'taxonomy' => TAX, 'hide_empty' => false ] );
	foreach ( is_array( $all ) ? $all : [] as $t ) {
		$cid = (string) get_term_meta( $t->term_id, 'ph_help_id', true );
		if ( $cid ) {
			$have[ $cid ] = $t;
		}
	}
	$map = [];
	foreach ( $cats as $c ) {
		$cid = $c['id'] ?? '';
		if ( ! safe_id( $cid ) || empty( $c['name'] ) ) {
			continue;
		}
		$parent = empty( $c['parentId'] ) ? 0 : ( $map[ $c['parentId'] ] ?? -1 );
		if ( $parent < 0 ) {
			continue;
		}
		$name = sanitize_text_field( $c['name'] );
		$desc = sanitize_textarea_field( (string) ( $c['description'] ?? '' ) );
		if ( isset( $have[ $cid ] ) ) {
			$t  = $have[ $cid ];
			$id = $t->term_id;
			if ( decode( $t->name ) !== $name || decode( $t->description ) !== $desc || (int) $t->parent !== $parent ) {
				wp_update_term( $id, TAX, [ 'name' => $name, 'description' => $desc, 'parent' => $parent ] );
			}
		} else {
			$r = wp_insert_term( $name, TAX, [ 'slug' => slugify( $name ), 'description' => $desc, 'parent' => $parent ] );
			if ( is_wp_error( $r ) ) {
				$tid = (int) $r->get_error_data( 'term_exists' );
				if ( ! $tid ) {
					continue;
				}
				$r = [ 'term_id' => $tid ];
			}
			$id = (int) $r['term_id'];
			update_term_meta( $id, 'ph_help_id', $cid );
		}
		set_meta( $id, 'ph_help_icon', sanitize_key( (string) ( $c['icon'] ?? '' ) ), true );
		set_meta( $id, 'ph_help_order', (int) ( $c['order'] ?? 0 ), true );
		set_meta( $id, '_seopress_titles_title', $name . ' | ' . SITE_NAME, true );
		set_meta( $id, '_seopress_titles_desc', wp_html_excerpt( $desc, 155 ), true );
		$map[ $cid ] = $id;
	}
	return $map;
}

function sync( $force = false ) {
	if ( get_transient( 'ph_sc_lock' ) ) {
		return [ 'busy' => true ] + (array) get_option( 'ph_sc_state', [] );
	}
	set_transient( 'ph_sc_lock', 1, 300 );
	if ( function_exists( 'set_time_limit' ) ) {
		@set_time_limit( 120 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
	}
	$t0  = microtime( true );
	$st  = [ 'at' => time(), 'ver' => VER, 'done' => 0, 'pending' => 0, 'unpublished' => 0, 'errors' => [] ];
	$src = null;
	try {
		$idx = fetch_json( 'index.json', $src );
		if ( ! $idx || ! isset( $idx['articles'], $idx['categories'] ) || ! is_array( $idx['articles'] ) || ! is_array( $idx['categories'] ) ) {
			$st['errors'][] = 'export unavailable';
			return $st;
		}
		$st['source']    = $src;
		$st['generated'] = sanitize_text_field( (string) ( $idx['generatedAt'] ?? '' ) );
		$rels            = fetch_json( 'releases.json' );
		if ( is_array( $rels ) ) {
			$clean = [];
			foreach ( $rels as $r ) {
				if ( is_array( $r ) && safe_id( $r['id'] ?? '' ) ) {
					$clean[] = [ 'id' => $r['id'], 'name' => sanitize_text_field( (string) ( $r['name'] ?? '' ) ), 'version' => sanitize_text_field( (string) ( $r['version'] ?? '' ) ), 'status' => sanitize_key( (string) ( $r['status'] ?? '' ) ), 'order' => (float) ( $r['order'] ?? 0 ) ];
				}
			}
			update_option( 'ph_sc_releases', $clean, false );
		}
		$retired = fetch_json( 'retired.json' );
		$retired = is_array( $retired ) ? array_flip( array_filter( $retired, 'is_string' ) ) : [];
		$tmap    = sync_terms( $idx['categories'] );
		$tslug   = [];
		$tpar    = [];
		foreach ( get_terms( [ 'taxonomy' => TAX, 'hide_empty' => false ] ) as $t ) {
			$tslug[ $t->term_id ] = $t->slug;
			$tpar[ $t->term_id ]  = (int) $t->parent;
		}
		$top  = function ( $tid ) use ( $tpar ) {
			while ( ! empty( $tpar[ $tid ] ) ) {
				$tid = $tpar[ $tid ];
			}
			return $tid;
		};
		$want = [];
		$urls = [];
		$pos  = 0;
		foreach ( $idx['articles'] as $a ) {
			$pos++;
			$cid = $a['id'] ?? '';
			if ( ! is_array( $a ) || ! safe_id( $cid ) || 'published' !== ( $a['status'] ?? '' ) || isset( $retired[ $cid ] ) || ! isset( $tmap[ $a['categoryId'] ?? '' ] ) ) {
				continue;
			}
			$a['_pos']    = $pos;
			$want[ $cid ] = $a;
			$urls[ $cid ] = base_url( $tslug[ $top( $tmap[ $a['categoryId'] ] ) ] . '/' . slugify( $a['slug'] ?? '' ?: $a['title'] ) . '/' );
		}
		$art_res = function ( $id ) use ( $urls ) {
			return $urls[ $id ] ?? null;
		};
		$cat_res = function ( $id ) use ( $tmap, $tslug, $tpar, $top ) {
			if ( ! isset( $tmap[ $id ] ) ) {
				return null;
			}
			$tid = $tmap[ $id ];
			return $tpar[ $tid ] ? base_url( $tslug[ $top( $tid ) ] . '/#' . $tslug[ $tid ] ) : base_url( $tslug[ $tid ] . '/' );
		};
		$have = [];
		foreach ( get_posts( [ 'post_type' => PT, 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids', 'no_found_rows' => true, 'suppress_filters' => true ] ) as $pid ) {
			$cid = (string) get_post_meta( $pid, 'ph_help_id', true );
			if ( $cid ) {
				$have[ $cid ] = [ 'ID' => $pid, 'status' => get_post_status( $pid ), 'sig' => (string) get_post_meta( $pid, 'ph_help_sig', true ) ];
			}
		}
		foreach ( $want as $cid => $a ) {
			$sig = md5( wp_json_encode( $a ) . '|' . $urls[ $cid ] . '|' . SYNC_VER );
			$h   = $have[ $cid ] ?? null;
			if ( $h && 'publish' === $h['status'] && $h['sig'] === $sig && ! $force ) {
				continue;
			}
			if ( $st['done'] >= BATCH || microtime( true ) - $t0 > 22 ) {
				$st['pending']++;
				continue;
			}
			$b = fetch_json( 'articles/' . rawurlencode( $cid ) . '.json' );
			if ( ! is_array( $b ) || ( $b['id'] ?? '' ) !== $cid ) {
				$st['errors'][] = $cid . ': body unavailable';
				continue;
			}
			$id = upsert( $a, $b, $h ? (int) $h['ID'] : 0, (int) $tmap[ $a['categoryId'] ], $sig, $art_res, $cat_res );
			if ( $id ) {
				$st['done']++;
			} else {
				$st['errors'][] = $cid . ': save failed';
			}
		}
		foreach ( $have as $cid => $h ) {
			if ( ! isset( $want[ $cid ] ) && 'publish' === $h['status'] ) {
				wp_update_post( [ 'ID' => $h['ID'], 'post_status' => 'draft' ] );
				$st['unpublished']++;
			}
		}
		flush_cache();
		$st['report'] = report( $idx, $tmap, $retired );
	} finally {
		$st['secs'] = round( microtime( true ) - $t0, 1 );
		update_option( 'ph_sc_state', $st, false );
		delete_transient( 'ph_sc_lock' );
	}
	return $st;
}

function upsert( $a, $b, $id, $term, $sig, callable $art_res, callable $cat_res ) {
	$src  = array_merge( $a, $b );
	$type = (string) ( $src['docType'] ?? 'faq' );
	$post = [
		'post_type'      => PT,
		'post_status'    => 'publish',
		'post_title'     => sanitize_text_field( (string) ( $src['title'] ?? '' ) ),
		'post_name'      => slugify( ( $src['slug'] ?? '' ) ?: ( $src['title'] ?? '' ) ),
		'post_excerpt'   => sanitize_textarea_field( (string) ( $src['summary'] ?? '' ) ),
		'post_content'   => clean_body( (string) ( $b['bodyMd'] ?? '' ), $art_res, $cat_res ),
		'menu_order'     => (int) ( $src['order'] ?? 0 ),
		'comment_status' => 'closed',
		'ping_status'    => 'closed',
	];
	if ( $id ) {
		$post['ID'] = $id;
	}
	kses_remove_filters();
	$r = $id ? wp_update_post( wp_slash( $post ), true ) : wp_insert_post( wp_slash( $post ), true );
	kses_init();
	if ( is_wp_error( $r ) || ! $r ) {
		return 0;
	}
	wp_set_object_terms( $r, [ $term ], TAX );
	$seo_t = sanitize_text_field( (string) first( $src, [ 'seoTitle' ] ) );
	$seo_d = sanitize_textarea_field( (string) first( $src, [ 'seoDescription', 'metaDescription', 'seoDesc' ] ) );
	$meta  = [
		'ph_help_id'                   => $a['id'],
		'ph_help_pos'                  => (int) $a['_pos'],
		'ph_help_doctype'              => isset( DOC_TYPES[ $type ] ) ? $type : 'faq',
		'ph_help_keywords'             => str_list( $src['keywords'] ?? [] ),
		'ph_help_questions'            => str_list( first( $src, [ 'questionVariants', 'questions' ] ) ?? [] ),
		'ph_help_direct_answer'        => sanitize_textarea_field( (string) first( $src, [ 'directAnswer' ] ) ),
		'ph_help_release_from'         => safe_id( $src['introducedInReleaseId'] ?? '' ) ? $src['introducedInReleaseId'] : '',
		'ph_help_release_to'           => safe_id( $src['removedInReleaseId'] ?? '' ) ? $src['removedInReleaseId'] : '',
		'ph_help_programme'            => sanitize_text_field( (string) first( $src, [ 'programme', 'programmeId', 'program', 'programId' ] ) ),
		'ph_help_project'              => sanitize_text_field( (string) first( $src, [ 'project', 'projectId' ] ) ),
		'ph_help_section_picker'       => ! empty( $src['sectionPicker'] ),
		'ph_help_section_picker_label' => sanitize_text_field( (string) ( $src['sectionPickerLabel'] ?? '' ) ),
		'ph_help_updated'              => sanitize_text_field( (string) ( $src['updatedAt'] ?? '' ) ),
		'ph_help_hash'                 => sanitize_text_field( (string) ( $src['contentHash'] ?? '' ) ),
		'ph_help_version'              => sanitize_text_field( (string) ( $src['version'] ?? ( $src['contentHash'] ?? '' ) ) ),
		'_seopress_titles_title'       => $seo_t ? $seo_t : $post['post_title'] . ' | ' . SITE_NAME,
		'_seopress_titles_desc'        => $seo_d ? $seo_d : wp_html_excerpt( $post['post_excerpt'], 155 ),
		'ph_help_article_type'         => in_array( $src['articleType'] ?? '', [ 'guide', 'faq', 'reference' ], true ) ? $src['articleType'] : '',
		'ph_help_sig'                  => $sig,
	];
	foreach ( $meta as $k => $v ) {
		set_meta( $r, $k, $v );
	}
	return (int) $r;
}

/** Article counts per top-level category: the console export (published, in range for the live release) against WordPress. */
function report( $idx, $tmap, $retired ) {
	$rels  = releases();
	$live  = null;
	$by    = [];
	foreach ( $rels as $r ) {
		$by[ $r['id'] ] = $r;
		if ( 'live' === $r['status'] && ( ! $live || $r['order'] > $live['order'] ) ) {
			$live = $r;
		}
	}
	$ok = function ( $from, $to ) use ( $live, $by ) {
		if ( ! $live ) {
			return true;
		}
		if ( $from && ( ! isset( $by[ $from ] ) || $by[ $from ]['order'] > $live['order'] ) ) {
			return false;
		}
		if ( $to && ( ! isset( $by[ $to ] ) || ! ( $live['order'] < $by[ $to ]['order'] ) ) ) {
			return false;
		}
		return true;
	};
	$parent = [];
	$names  = [];
	foreach ( $idx['categories'] as $c ) {
		if ( is_array( $c ) && isset( $c['id'] ) ) {
			$parent[ $c['id'] ] = $c['parentId'] ?? '';
			$names[ $c['id'] ]  = (string) ( $c['name'] ?? '' );
		}
	}
	$console = [];
	foreach ( $idx['articles'] as $a ) {
		if ( ! is_array( $a ) || 'published' !== ( $a['status'] ?? '' ) || isset( $retired[ $a['id'] ?? '' ] ) || ! $ok( $a['introducedInReleaseId'] ?? '', $a['removedInReleaseId'] ?? '' ) ) {
			continue;
		}
		$c = $a['categoryId'] ?? '';
		$c = ! empty( $parent[ $c ] ) ? $parent[ $c ] : $c;
		$console[ $c ] = ( $console[ $c ] ?? 0 ) + 1;
	}
	$rows = [];
	foreach ( $idx['categories'] as $c ) {
		if ( ! is_array( $c ) || ! empty( $c['parentId'] ) || ! isset( $tmap[ $c['id'] ?? '' ] ) ) {
			continue;
		}
		$n = 0;
		$t = $tmap[ $c['id'] ];
		foreach ( catalogue()['arts'] as $a ) {
			$p = parent_cat( $a['cat'] );
			if ( $p && $p['id'] === $t && $ok( $a['from'], $a['to'] ) ) {
				$n++;
			}
		}
		$rows[] = [ 'category' => $names[ $c['id'] ], 'console' => $console[ $c['id'] ] ?? 0, 'wordpress' => $n ];
	}
	return $rows;
}

/* Rate-limited ping that queues a single sync event; the sync itself always runs from cron, never in the request. */
function refresh_request() {
	$until = (int) get_transient( 'ph_sc_refresh' );
	if ( $until > time() ) {
		$res = new \WP_REST_Response( [ 'queued' => false, 'retryAfter' => max( 1, $until - time() ) ], 429 );
		$res->header( 'Retry-After', (string) max( 1, $until - time() ) );
		return $res;
	}
	set_transient( 'ph_sc_refresh', time() + 60, 60 );
	$next = wp_next_scheduled( 'ph_sc_sync' );
	if ( ! $next || $next > time() + 60 ) {
		/* Due now, not in 5 s: WP only spawns cron for an event already due, and wp-cron.php runs only what is due when it starts. */
		wp_schedule_single_event( time(), 'ph_sc_sync' );
	}
	/* Non-blocking loopback to wp-cron.php: this host does not spawn cron from front-end traffic, so ask for it. */
	spawn_cron();
	return new \WP_REST_Response( [ 'queued' => true ], 202 );
}

/* ---------- REST: sync, status, redirect map, search index ---------- */
add_action( 'rest_api_init', function () {
	$admin = function () {
		return current_user_can( 'manage_options' );
	};
	register_rest_route( 'ph-help/v1', '/sync', [
		'methods'             => 'POST',
		'permission_callback' => $admin,
		'callback'            => function ( $req ) {
			return rest_ensure_response( sync( (bool) $req->get_param( 'force' ) ) );
		},
	] );
	register_rest_route( 'ph-help/v1', '/status', [
		'methods'             => 'GET',
		'permission_callback' => $admin,
		'callback'            => function () {
			return rest_ensure_response( [ 'live' => LIVE, 'ver' => VER, 'state' => get_option( 'ph_sc_state', [] ), 'releases' => releases(), 'next_sync' => wp_next_scheduled( 'ph_sc_sync' ) ] );
		},
	] );
	/* Public refresh ping: asks for one sync soon. Takes no input, never syncs inline, at most once per 60 s site-wide. */
	register_rest_route( 'ph-help/v1', '/refresh', [
		'methods'             => 'POST',
		'permission_callback' => '__return_true',
		'args'                => [],
		'callback'            => function () {
			return refresh_request();
		},
	] );
	/* Old help.personalisationhub.com URLs (and the Freshdesk paths it redirected) mapped to Support Centre URLs. Public once live: it lists only public pages. */
	register_rest_route( 'ph-help/v1', '/redirects', [
		'methods'             => 'GET',
		'permission_callback' => function () {
			return LIVE || current_user_can( 'manage_options' );
		},
		'callback'            => function () {
			$old = 'https://help.personalisationhub.com/';
			$map = [ $old => base_url(), $old . 'index.html' => base_url(), $old . 'search.html' => base_url( 'search/' ) ];
			foreach ( cats() as $c ) {
				if ( $c['cid'] ) {
					$map[ $old . 'category.html?id=' . $c['cid'] ] = cat_url( $c );
				}
			}
			foreach ( visible() as $a ) {
				$map[ $old . 'article.html?id=' . $a['cid'] ] = art_url( $a );
				if ( preg_match( '/^faq-art-(\d+)$/', $a['cid'], $m ) ) {
					$map[ $old . 'support/solutions/articles/' . $m[1] ] = art_url( $a );
				}
			}
			$r = rest_ensure_response( $map );
			$r->header( 'Cache-Control', 'public, max-age=300' );
			return $r;
		},
	] );
	/* What is live on WordPress, per console article: the console compares hash with its contentHash for in sync / waiting / failed. */
	register_rest_route( 'ph-help/v1', '/published', [
		'methods'             => 'GET',
		'permission_callback' => function () {
			return LIVE || current_user_can( 'edit_posts' );
		},
		'callback'            => function () {
			$st     = (array) get_option( 'ph_sc_state', [] );
			$failed = [];
			foreach ( (array) ( $st['errors'] ?? [] ) as $err ) {
				if ( preg_match( '/^([A-Za-z0-9_-]{1,120}): /', (string) $err, $m ) ) {
					$failed[] = $m[1];
				}
			}
			$out = [];
			foreach ( visible() as $a ) {
				$out[] = [ 'id' => $a['cid'], 'url' => art_url( $a ), 'wpId' => $a['id'], 'hash' => $a['hash'], 'updatedAt' => $a['updated'] ];
			}
			$r = rest_ensure_response( [ 'lastSync' => empty( $st['at'] ) ? null : gmdate( 'c', (int) $st['at'] ), 'pending' => (int) ( $st['pending'] ?? 0 ), 'failed' => $failed, 'articles' => $out ] );
			$r->header( 'Cache-Control', 'public, max-age=300' );
			return $r;
		},
	] );
	register_rest_route( 'ph-help/v1', '/index', [
		'methods'             => 'GET',
		'permission_callback' => function () {
			return LIVE || current_user_can( 'edit_posts' );
		},
		'callback'            => function () {
			$out = [];
			foreach ( visible() as $a ) {
				$c     = parent_cat( $a['cat'] );
				$out[] = [ 't' => $a['title'], 'u' => art_url( $a ), 'c' => $c ? $c['name'] : '', 's' => $a['summary'], 'k' => $a['kw'], 'q' => $a['q'], 'o' => $a['order'] ];
			}
			$r = rest_ensure_response( $out );
			if ( LIVE && ! is_user_logged_in() ) {
				$r->header( 'Cache-Control', 'public, max-age=300' );
			}
			return $r;
		},
	] );
} );

/* Internal fields (console ids, hashes, release ids) are never served to visitors through the core REST API. */
add_filter( 'rest_pre_dispatch', function ( $result, $server, $request ) {
	$route = $request->get_route();
	if ( ( str_starts_with( $route, '/wp/v2/help-articles' ) || str_starts_with( $route, '/wp/v2/help-categories' ) ) && ! current_user_can( 'edit_posts' ) ) {
		return new \WP_Error( 'rest_forbidden', 'Not available.', [ 'status' => rest_authorization_required_code() ] );
	}
	return $result;
}, 10, 3 );

add_filter( 'rest_post_search_query', function ( $args ) {
	if ( ! active() && isset( $args['post_type'] ) ) {
		$args['post_type'] = array_values( array_diff( (array) $args['post_type'], [ PT ] ) );
	}
	return $args;
} );

/* ---------- markup (ports of index.html, category.html, article.html and search.html) ---------- */
function icon( $name, $size = 22, $cls = 'icon' ) {
	$k = isset( ICONS[ $name ] ) ? $name : ( ICON_ALIASES[ $name ] ?? 'help' );
	$d = ICONS[ $k ] ?? ICONS['help'];
	return '<svg class="' . esc_attr( $cls ) . '" width="' . (int) $size . '" height="' . (int) $size . '" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path fill="currentColor" d="' . esc_attr( $d ) . '"/></svg>';
}

function e( $s ) {
	return esc_html( (string) $s );
}

function search_box( $q = '' ) {
	return '<div class="search-wrap"><span class="search-icon" id="search-icon">' . icon( 'search', 20 ) . '</span>'
		. '<form class="search-form" role="search" method="get" action="' . esc_url( base_url( 'search/' ) ) . '">'
		. '<label for="faq-search" class="visually-hidden">Search articles</label>'
		. '<input type="search" id="faq-search" name="q" class="search-box" placeholder="Search for articles…" autocomplete="off" value="' . esc_attr( $q ) . '">'
		. '</form><div class="search-results" id="faq-search-results" hidden></div></div>';
}

function hero_compact( $q = '' ) {
	return '<section class="hero hero-compact">' . search_box( $q ) . '</section>';
}

function crumb_home() {
	return '<a href="' . esc_url( base_url() ) . '">Help Centre</a> <span class="sep">›</span> ';
}

function row( $a, $n = 0, $cat = false ) {
	$p = '';
	if ( $cat ) {
		$c = parent_cat( $a['cat'] );
		$p = '<span class="row-cat">' . e( $c ? $c['name'] : '' ) . '</span> &middot; ';
	}
	return '<a class="article-row" href="' . esc_url( art_url( $a ) ) . '">'
		. ( $n ? '<span class="row-num">' . (int) $n . '</span>' : '' )
		. '<span class="row-main"><h3>' . e( $a['title'] ) . ' <span class="doctype-badge doctype-badge-inline">' . e( doc_label( $a ) ) . '</span></h3>'
		. '<p>' . $p . e( $a['summary'] ) . '</p></span>'
		. '<span class="row-chevron">' . icon( 'chevron_right', 20 ) . '</span></a>';
}

function view_front() {
	$h     = '<section class="hero"><h1>How can we help?</h1><p>Search the guides, or browse by topic in the order a new customer sets things up.</p>' . search_box();
	$start = art_by_cid( START );
	if ( $start ) {
		$h .= '<p class="start-here"><a href="' . esc_url( art_url( $start ) ) . '">New to Personalisation Hub? Start with the recommended set-up order</a></p>';
	}
	$h  .= '</section><div class="wrap" id="main">';
	$top = top_cats();
	if ( ! $top ) {
		return $h . '<p class="empty-hint">No categories published yet.</p></div>';
	}
	$h .= '<div class="cat-grid" id="cat-grid">';
	foreach ( $top as $i => $c ) {
		$n  = count( arts_under( $c['id'] ) );
		$h .= '<a class="cat-card" href="' . esc_url( cat_url( $c ) ) . '"><div class="cat-top"><div class="cat-icon">' . icon( $c['icon'] ?: 'help', 22 ) . '</div><span class="cat-step">' . ( $i + 1 ) . '</span></div>'
			. '<h2>' . e( $c['name'] ) . '</h2><p>' . e( $c['desc'] ) . '</p><div class="cat-count">' . $n . ' article' . ( 1 === $n ? '' : 's' ) . '</div></a>';
	}
	return $h . '</div></div>';
}

function view_category( $c ) {
	$h   = hero_compact() . '<div class="wrap" id="main"><nav class="breadcrumb" aria-label="Breadcrumb">' . crumb_home() . '<span id="crumb-cat">' . e( $c['name'] ) . '</span></nav>';
	$h  .= '<div class="page-title"><div class="cat-icon" id="cat-icon">' . icon( $c['icon'] ?: 'help', 20 ) . '</div><h1 id="cat-name">' . e( $c['name'] ) . '</h1></div><p class="page-desc" id="cat-desc">' . e( $c['desc'] ) . '</p>';
	$all = arts_under( $c['id'] );
	if ( ! $all ) {
		$h .= '<p class="empty-hint" id="article-empty">No published articles in this category yet.</p>';
	} else {
		$n  = 0;
		$h .= '<div class="article-list" id="article-list">';
		foreach ( arts_in( $c['id'] ) as $a ) {
			$h .= row( $a, ++$n );
		}
		foreach ( sub_cats( $c['id'] ) as $s ) {
			$sa = arts_in( $s['id'] );
			if ( ! $sa ) {
				continue;
			}
			$h .= '<section class="folder-section" id="' . esc_attr( $s['slug'] ) . '"><h2 class="folder-heading">' . icon( 'folder', 18, 'icon folder-heading-icon' ) . ' ' . e( $s['name'] ) . '</h2>'
				. ( $s['desc'] ? '<p class="folder-desc">' . e( $s['desc'] ) . '</p>' : '' );
			foreach ( $sa as $a ) {
				$h .= row( $a, ++$n );
			}
			$h .= '</section>';
		}
		$h .= '</div>';
	}
	$top  = top_cats();
	$i    = array_search( $c['id'], array_column( $top, 'id' ), true );
	$prev = ( false !== $i && $i > 0 ) ? $top[ $i - 1 ] : null;
	$next = ( false !== $i && $i < count( $top ) - 1 ) ? $top[ $i + 1 ] : null;
	$h   .= '<p class="cat-nav" id="cat-nav">'
		. ( $prev ? '<a class="nav-prev" href="' . esc_url( cat_url( $prev ) ) . '">' . icon( 'arrow_back', 16 ) . ' ' . e( $prev['name'] ) . '</a>' : '<span></span>' )
		. ( $next ? '<a class="nav-next" href="' . esc_url( cat_url( $next ) ) . '">' . e( $next['name'] ) . ' ' . icon( 'arrow_forward', 16 ) . '</a>' : '' ) . '</p>';
	return $h . '</div>';
}

/** Gives every H2 an id and returns the "On this page" entries (Related and Next step are cross-links, not topics). */
function h2_ids( $html, &$toc ) {
	$toc = [];
	return preg_replace_callback( '#<h2\b([^>]*)>(.*?)</h2>#is', function ( $m ) use ( &$toc ) {
		$text = trim( decode( wp_strip_all_tags( $m[2] ) ) );
		$slug = trim( preg_replace( '/[^a-z0-9]+/', '-', strtolower( $text ) ), '-' );
		$slug = '' === $slug ? 'section' : $slug;
		if ( ! in_array( strtolower( $text ), NON_TOPIC, true ) ) {
			$toc[] = [ $slug, $text ];
		}
		return '<h2' . preg_replace( '/\s+id="[^"]*"/i', '', $m[1] ) . ' id="' . esc_attr( $slug ) . '">' . $m[2] . '</h2>';
	}, $html );
}

function body_html( $a, &$toc = null ) {
	$post = get_post( $a['id'] );
	$html = $post ? wp_kses( $post->post_content, allowed_html(), PROTOCOLS ) : '';
	$html = fix_iframes( $html );
	$html = fix_links( $html, function ( $cid ) {
		$t = art_by_cid( $cid );
		return $t ? art_url( $t ) : null;
	}, function ( $cid ) {
		$c = cat_by_cid( $cid );
		return $c ? cat_url( $c ) : null;
	} );
	return h2_ids( $html, $toc );
}

function view_article( $a ) {
	$folder = cats()[ $a['cat'] ] ?? null;
	$cat    = parent_cat( $a['cat'] );
	$toc    = [];
	$body   = body_html( $a, $toc );
	$h      = hero_compact() . '<div class="wrap wrap-article" id="main"><nav class="breadcrumb" aria-label="Breadcrumb">' . crumb_home();
	if ( $cat ) {
		$h .= '<a id="crumb-cat-link" href="' . esc_url( cat_url( $cat ) ) . '"><span id="crumb-cat">' . e( $cat['name'] ) . '</span></a> ';
		if ( $folder && $folder['id'] !== $cat['id'] ) {
			$h .= '<span class="sep">›</span> <span id="crumb-folder">' . e( $folder['name'] ) . '</span> ';
		}
		$h .= '<span class="sep">›</span> ';
	}
	$h      .= '<span id="crumb-article">' . e( $a['title'] ) . '</span></nav>';
	$has_toc = count( $toc ) >= 3;
	$h      .= '<div class="article-layout' . ( $has_toc ? ' has-toc' : '' ) . '"><article id="article-content"><div class="article-header">';
	if ( $cat ) {
		$h .= '<span class="article-cat-badge" id="cat-badge"><span id="cat-badge-icon">' . icon( $cat['icon'] ?: 'help', 14 ) . '</span><span id="cat-badge-name">' . e( $cat['name'] ) . '</span></span>';
	}
	$h .= '<span class="doctype-badge" id="doctype-badge">' . e( doc_label( $a ) ) . '</span><h1 id="article-title">' . e( $a['title'] ) . '</h1><p class="article-meta" id="article-meta">' . e( $a['summary'] ) . '</p></div>';
	$h .= '<div class="article-body" id="article-body"' . ( $a['picker'] ? ' data-picker="1" data-picker-label="' . esc_attr( $a['plabel'] ) . '"' : '' ) . '>';
	if ( $a['answer'] ) {
		$h .= '<div class="callout callout-note article-answer"><p>' . e( $a['answer'] ) . '</p></div>';
	}
	$h .= $body . '</div>';
	$ts = $a['updated'] ? strtotime( $a['updated'] ) : 0;
	if ( $ts ) {
		$h .= '<p class="article-updated" id="article-updated">Last updated ' . e( wp_date( 'j F Y', $ts ) ) . '</p>';
	}
	$related = [];
	$nav     = '<span></span>';
	if ( $cat ) {
		$seq  = arts_under( $cat['id'] );
		$i    = array_search( $a['id'], array_column( $seq, 'id' ), true );
		$prev = ( false !== $i && $i > 0 ) ? $seq[ $i - 1 ] : null;
		$next = ( false !== $i && $i < count( $seq ) - 1 ) ? $seq[ $i + 1 ] : null;
		$nav  = ( $prev ? '<a class="nav-prev" href="' . esc_url( art_url( $prev ) ) . '"><span class="nav-label">' . icon( 'arrow_back', 16 ) . ' Previous</span><span class="nav-title">' . e( $prev['title'] ) . '</span></a>' : '<span></span>' )
			. ( $next ? '<a class="nav-next" href="' . esc_url( art_url( $next ) ) . '"><span class="nav-label">Next ' . icon( 'arrow_forward', 16 ) . '</span><span class="nav-title">' . e( $next['title'] ) . '</span></a>' : '' );
		$sibs = ( $folder && $folder['id'] !== $cat['id'] ) ? array_values( array_filter( $seq, function ( $x ) use ( $folder ) {
			return $x['cat'] === $folder['id'];
		} ) ) : $seq;
		$related = array_slice( array_values( array_filter( $sibs, function ( $x ) use ( $a ) {
			return $x['id'] !== $a['id'];
		} ) ), 0, 5 );
	}
	$h .= '<nav class="article-nav" id="article-nav" aria-label="Previous and next article">' . $nav . '</nav></article>';
	if ( $has_toc ) {
		$h .= '<aside class="toc" id="toc"><h2 class="toc-title">On this page</h2><ol id="toc-list">';
		foreach ( $toc as $t ) {
			$h .= '<li><a href="#' . esc_attr( $t[0] ) . '">' . e( $t[1] ) . '</a></li>';
		}
		$h .= '</ol></aside>';
	}
	$h .= '</div>';
	if ( $related ) {
		$h .= '<div class="related-block" id="related-block"><h2 class="related-title">More in this section</h2><div class="article-list" id="related-list">';
		foreach ( $related as $r ) {
			$h .= row( $r );
		}
		$h .= '</div></div>';
	}
	return $h . '</div>';
}

function view_search( $q ) {
	$m = search_articles( visible(), $q );
	$n = count( $m );
	$h = hero_compact( $q ) . '<div class="wrap" id="main"><nav class="breadcrumb" aria-label="Breadcrumb">' . crumb_home() . 'Search results</nav>'
		. '<h1 id="results-heading" class="results-heading" aria-live="polite">' . ( '' !== $q ? $n . ' result' . ( 1 === $n ? '' : 's' ) . ' for "' . e( $q ) . '"' : 'Search results' ) . '</h1>';
	if ( ! $n ) {
		return $h . '<p class="empty-hint" id="results-empty">No articles matched your search. Try different words, or browse the categories on the <a href="' . esc_url( base_url() ) . '">Help Centre home page</a>.</p></div>';
	}
	$h .= '<div class="article-list" id="results-list">';
	foreach ( $m as $a ) {
		$h .= row( $a, 0, true );
	}
	return $h . '</div></div>';
}

function view_notfound() {
	return hero_compact() . '<div class="wrap wrap-article" id="main"><nav class="breadcrumb" aria-label="Breadcrumb">' . crumb_home() . '<span id="crumb-article">Not found</span></nav>'
		. '<div class="article-layout"><article id="article-content"><div class="article-header"><h1 id="article-title">Article not found</h1></div></article></div>'
		. '<p class="empty-hint" id="article-empty">This article doesn\'t exist or hasn\'t been published yet.</p></div>';
}

function banner() {
	if ( LIVE ) {
		return '';
	}
	$st = (array) get_option( 'ph_sc_state', [] );
	return '<div class="ph-sc-stage" role="note"><strong>Staging preview.</strong> Only signed-in editors can see this Support Centre; visitors still see the current Help Centre until go-live. Last sync from the PH Agent Console: '
		. e( ! empty( $st['at'] ) ? human_time_diff( (int) $st['at'] ) . ' ago' : 'not yet' ) . '.</div>';
}

function render( $v ) {
	switch ( $v['type'] ) {
		case 'front':
			$inner = view_front();
			break;
		case 'category':
			$inner = view_category( $v['cat'] );
			break;
		case 'article':
			$inner = view_article( $v['art'] );
			break;
		case 'search':
			$inner = view_search( $v['q'] );
			break;
		default:
			$inner = view_notfound();
	}
	$data = ' data-index="' . esc_url( rest_url( 'ph-help/v1/index' ) ) . '" data-search="' . esc_url( base_url( 'search/' ) ) . '"';
	if ( is_user_logged_in() ) {
		$data .= ' data-nonce="' . esc_attr( wp_create_nonce( 'wp_rest' ) ) . '"';
	}
	if ( isset( $_GET['release'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
		$data .= ' data-release="' . esc_attr( sanitize_text_field( wp_unslash( $_GET['release'] ) ) ) . '"'; // phpcs:ignore WordPress.Security.NonceVerification
	}
	if ( 'article' === $v['type'] ) {
		$data .= ' data-article="' . esc_attr( $v['art']['cid'] ) . '"';
	}
	return '<main id="content" class="ph-sc ph-sc-' . esc_attr( $v['type'] ) . '"' . $data . '>' . banner() . $inner . '</main>';
}

/* ---------- markdown twins ---------- */
function html_to_md( $html ) {
	$keep = [];
	$hold = function ( $s ) use ( &$keep ) {
		$keep[] = $s;
		return "\x01" . ( count( $keep ) - 1 ) . "\x02";
	};
	$text = function ( $s ) {
		return trim( preg_replace( '/\s+/u', ' ', decode( wp_strip_all_tags( $s ) ) ) );
	};
	$h = preg_replace( '#<(svg|script|style|button|nav|iframe)\b.*?</\1>#is', '', $html );
	$h = preg_replace_callback( '#<pre[^>]*>(.*?)</pre>#is', function ( $m ) use ( $hold ) {
		return "\n\n" . $hold( "```\n" . rtrim( decode( wp_strip_all_tags( $m[1] ) ) ) . "\n```" ) . "\n\n";
	}, $h );
	$h = preg_replace_callback( '#<code[^>]*>(.*?)</code>#is', function ( $m ) use ( $hold ) {
		return $hold( '`' . decode( wp_strip_all_tags( $m[1] ) ) . '`' );
	}, $h );
	$h = preg_replace_callback( '#<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>#is', function ( $m ) use ( $hold ) {
		return '[' . $m[2] . '](' . $hold( decode( $m[1] ) ) . ')';
	}, $h );
	$h = preg_replace( '#<(strong|b)\b[^>]*>(.*?)</\1>#is', '**$2**', $h );
	$h = preg_replace( '#<(em|i)\b[^>]*>(.*?)</\1>#is', '*$2*', $h );
	$h = preg_replace_callback( '#<table\b[^>]*>(.*?)</table>#is', function ( $m ) use ( $text ) {
		preg_match_all( '#<tr[^>]*>(.*?)</tr>#is', $m[1], $rows );
		$out = '';
		foreach ( $rows[1] as $i => $r ) {
			preg_match_all( '#<t[hd][^>]*>(.*?)</t[hd]>#is', $r, $cells );
			$cells = array_map( function ( $c ) {
				return str_replace( '|', '\|', trim( preg_replace( '/\s+/u', ' ', wp_strip_all_tags( $c ) ) ) );
			}, $cells[1] );
			$out .= '| ' . implode( ' | ', $cells ) . " |\n";
			if ( 0 === $i ) {
				$out .= '|' . str_repeat( ' --- |', max( 1, count( $cells ) ) ) . "\n";
			}
		}
		return "\n\n" . $out . "\n";
	}, $h );
	$h = preg_replace_callback( '#<div class="callout callout-(note|important|warning)[^"]*"[^>]*>(.*?)</div>#is', function ( $m ) use ( $text ) {
		return "\n\n> **" . ucfirst( $m[1] ) . ':** ' . $text( $m[2] ) . "\n\n";
	}, $h );
	foreach ( [ 2 => '##', 3 => '###', 4 => '####' ] as $n => $pfx ) {
		$h = preg_replace_callback( '#<h' . $n . '\b[^>]*>(.*?)</h' . $n . '>#is', function ( $m ) use ( $pfx, $text ) {
			return "\n\n" . $pfx . ' ' . $text( $m[1] ) . "\n\n";
		}, $h );
	}
	$h = preg_replace_callback( '#<(ol|ul)\b[^>]*>(.*?)</\1>#is', function ( $m ) {
		preg_match_all( '#<li\b([^>]*)>(.*?)</li>#is', $m[2], $items, PREG_SET_ORDER );
		$out = "\n";
		$n   = 0;
		foreach ( $items as $it ) {
			$lvl  = preg_match( '/ql-indent-(\d)/', $it[1], $x ) ? (int) $x[1] : 0;
			$body = trim( preg_replace( '/\s+/u', ' ', $it[2] ) );
			if ( 'ol' === $m[1] && 0 === $lvl ) {
				$out .= ( ++$n ) . '. ' . $body . "\n";
			} else {
				$out .= str_repeat( '   ', $lvl ) . '- ' . $body . "\n";
			}
		}
		return $out . "\n";
	}, $h );
	$h = preg_replace( '#<br\s*/?>#i', "\n", $h );
	$h = preg_replace( '#</(p|div|section|blockquote|figure|li)>#i', "\n\n", $h );
	$h = decode( wp_strip_all_tags( $h ) );
	$h = preg_replace_callback( "/\x01(\d+)\x02/", function ( $m ) use ( &$keep ) {
		return $keep[ (int) $m[1] ];
	}, $h );
	$h = preg_replace_callback( "/\x01(\d+)\x02/", function ( $m ) use ( &$keep ) {
		return $keep[ (int) $m[1] ];
	}, $h );
	$h = preg_replace( "/[ \t]+\n/", "\n", $h );
	$h = preg_replace( "/\n{3,}/", "\n\n", $h );
	return trim( $h );
}

function md_list( $arts ) {
	$md = '';
	foreach ( $arts as $a ) {
		$md .= '- [' . $a['title'] . '](' . md_url( art_url( $a ) ) . ')' . ( $a['summary'] ? ': ' . $a['summary'] : '' ) . "\n";
	}
	return $md;
}

function markdown( $v ) {
	if ( 'article' === $v['type'] ) {
		$a      = $v['art'];
		$cat    = parent_cat( $a['cat'] );
		$folder = cats()[ $a['cat'] ] ?? null;
		$out    = '# ' . $a['title'] . "\n\n" . ( $a['summary'] ? '> ' . $a['summary'] . "\n\n" : '' );
		$out   .= doc_label( $a ) . ( $cat ? ' · ' . $cat['name'] . ( $folder && $folder['id'] !== $cat['id'] ? ' › ' . $folder['name'] : '' ) : '' );
		$out   .= ( $a['updated'] && strtotime( $a['updated'] ) ? ' · Last updated ' . wp_date( 'j F Y', strtotime( $a['updated'] ) ) : '' ) . "\n\nURL: " . art_url( $a ) . "\n\n";
		if ( $a['answer'] ) {
			$out .= '**In short:** ' . $a['answer'] . "\n\n";
		}
		if ( $a['q'] ) {
			$out .= 'Also asked as: ' . implode( '; ', $a['q'] ) . "\n\n";
		}
		return $out . html_to_md( body_html( $a ) ) . "\n";
	}
	if ( 'category' === $v['type'] ) {
		$c   = $v['cat'];
		$out = '# ' . $c['name'] . "\n\n" . ( $c['desc'] ? '> ' . $c['desc'] . "\n\n" : '' ) . 'Part of the [' . SITE_NAME . '](' . md_url( base_url() ) . ").\n\n";
		$out .= md_list( arts_in( $c['id'] ) );
		foreach ( sub_cats( $c['id'] ) as $s ) {
			$sa = arts_in( $s['id'] );
			if ( $sa ) {
				$out .= "\n## " . $s['name'] . "\n\n" . ( $s['desc'] ? $s['desc'] . "\n\n" : '' ) . md_list( $sa );
			}
		}
		return $out;
	}
	$out = '# ' . SITE_NAME . "\n\n> Set-up guides, how-tos and reference for the Personalisation Hub platform, in the order a new customer sets things up.\n\n";
	foreach ( top_cats() as $i => $c ) {
		$out .= "\n## " . ( $i + 1 ) . '. ' . $c['name'] . "\n\n" . ( $c['desc'] ? $c['desc'] . "\n\n" : '' ) . md_list( arts_under( $c['id'] ) );
	}
	return $out;
}

/* ---------- structured data ---------- */
/** Identical to PH Agent Endpoint's organization_node(): one Organization on every page. */
function org() {
	return [
		'@type'       => 'Organization',
		'@id'         => home_url( '/#organization' ),
		'name'        => 'Personalisation Hub',
		'legalName'   => 'Personalisation Hub Pty Ltd',
		'url'         => home_url( '/' ),
		'logo'        => 'https://personalisationhub.com/wp-content/uploads/2022/12/Website-Logo.png',
		'description' => "Self-hosted, self-optimising omnichannel personalisation and retail media platform for physical retail, deployed in the retailer's own cloud.",
		'foundingDate' => '2018',
		'founder'     => [ '@type' => 'Person', 'name' => 'Rob Geerdink' ],
		'sameAs'      => [
			'https://www.linkedin.com/company/personalisation-hub/',
			'https://aws.amazon.com/marketplace/pp/prodview-3uiwcnbrpvj76',
			'https://signage.amazon.com/cms-partners/personalisation-hub',
			'https://twitter.com/Digital_retail',
			'https://aws.amazon.com/marketplace/seller-profile?id=seller-ipgfe4tzltv24'
		],
		'knowsAbout'  => [
			'AI-native digital signage',
			'In-store personalisation',
			'White-label retail media platform',
			'Queue management',
			'Appointment booking',
			'Mobile store sites',
			'Omnichannel personalisation',
			'Self-hosted retail software on AWS',
		],
		'areaServed'  => 'Worldwide',
	];
}

/** Identical to PH Agent Endpoint's software_node(): one SoftwareApplication on every page. */
function software() {
	return [
		'@type'               => 'SoftwareApplication',
		'@id'                 => home_url( '/#software' ),
		'name'                => 'Personalisation Hub',
		'url'                 => home_url( '/' ),
		'description'         => "Self-hosted, self-optimising omnichannel personalisation and retail media platform for physical retail, deployed in the retailer's own cloud.",
		'applicationCategory' => 'BusinessApplication',
		'operatingSystem'     => 'Web',
		'applicationSubCategory' => 'Digital signage and in-store personalisation software',
		'featureList'         => [
			'AI-native digital signage',
			'In-store personalisation',
			'White-label retail media platform',
			'Queue management',
			'Appointment booking',
			'Mobile store sites',
			'Localisation and geo-targeting',
			'AI agents that create campaigns',
			'Self-hosted in your own AWS account',
		],
		'softwareHelp'        => [ '@type' => 'CreativeWork', 'name' => 'Personalisation Hub Support Centre', 'url' => home_url( '/support-centre/' ) ],
		'audience'            => [ '@type' => 'BusinessAudience', 'audienceType' => 'Businesses with physical stores' ],
		'publisher'           => [ '@id' => home_url( '/#organization' ) ],
		'offers'              => [
			'@type'         => 'Offer',
			'name'          => 'Free trial on AWS Marketplace',
			'price'         => '0',
			'priceCurrency' => 'USD',
			'url'           => 'https://aws.amazon.com/marketplace/pp/prodview-3uiwcnbrpvj76',
			'availability'  => 'https://schema.org/InStock',
			'description'   => "30-day free trial on AWS Marketplace, then billed through the customer's AWS account",
		],
	];
}

function crumbs( array $items ) {
	$list = [ [ '@type' => 'ListItem', 'position' => 1, 'name' => 'Support Centre', 'item' => base_url() ] ];
	foreach ( $items as $i => $it ) {
		$list[] = [ '@type' => 'ListItem', 'position' => $i + 2, 'name' => $it[0], 'item' => $it[1] ];
	}
	return [ '@type' => 'BreadcrumbList', 'itemListElement' => $list ];
}

function plain( $s, $max = 500 ) {
	$t = trim( preg_replace( '/\s+/u', ' ', decode( wp_strip_all_tags( $s ) ) ) );
	return mb_strlen( $t ) > $max ? rtrim( mb_substr( $t, 0, $max - 1 ) ) . '…' : $t;
}

/** Splits a rendered body into its H2 sections: [ heading text, section html ]. */
function sections( $html ) {
	$parts = preg_split( '#(<h2\b[^>]*>.*?</h2>)#is', $html, -1, PREG_SPLIT_DELIM_CAPTURE );
	$out   = [];
	for ( $i = 1; $i < count( $parts ); $i += 2 ) {
		$out[] = [ plain( $parts[ $i ], 200 ), $parts[ $i + 1 ] ?? '' ];
	}
	return $out;
}

function article_ld( $a ) {
	$url  = art_url( $a );
	$cat  = parent_cat( $a['cat'] );
	$body = body_html( $a );
	$desc = $a['answer'] ? $a['answer'] : $a['summary'];
	$base = [ 'url' => $url, 'inLanguage' => 'en-GB', 'dateModified' => $a['updated'], 'publisher' => [ '@id' => home_url( '/#organization' ) ], 'isPartOf' => [ '@type' => 'WebSite', 'name' => SITE_NAME, 'url' => base_url() ] ];
	if ( $a['kw'] ) {
		$base['keywords'] = implode( ', ', $a['kw'] );
	}
	$main   = null;
	$schema = [ 'guide' => 'howto', 'faq' => 'faq', 'reference' => 'tech' ][ $a['atype'] ] ?? ( [ 'how-to' => 'howto', 'faq' => 'faq' ][ $a['type'] ] ?? 'tech' );
	if ( 'howto' === $schema ) {
		$steps = [];
		foreach ( sections( $body ) as $s ) {
			if ( ! in_array( strtolower( $s[0] ), NON_STEP, true ) ) {
				$steps[] = [ '@type' => 'HowToStep', 'position' => count( $steps ) + 1, 'name' => $s[0], 'text' => plain( $s[1], 600 ), 'url' => $url . '#' . trim( preg_replace( '/[^a-z0-9]+/', '-', strtolower( $s[0] ) ), '-' ) ];
			}
		}
		if ( count( $steps ) < 2 && preg_match( '#<ol\b[^>]*>(.*?)</ol>#is', $body, $ol ) ) {
			$steps = [];
			preg_match_all( '#<li\b(?![^>]*ql-indent)[^>]*>(.*?)</li>#is', $ol[1], $li );
			foreach ( $li[1] as $t ) {
				$steps[] = [ '@type' => 'HowToStep', 'position' => count( $steps ) + 1, 'text' => plain( $t, 600 ) ];
			}
		}
		if ( count( $steps ) >= 2 ) {
			$main = $base + [ '@type' => 'HowTo', '@id' => $url . '#howto', 'name' => $a['title'], 'description' => $desc, 'step' => $steps ];
		}
	} elseif ( 'faq' === $schema ) {
		$first = preg_match( '#<p\b[^>]*>(.*?)</p>#is', $body, $p ) ? plain( $p[1], 1000 ) : '';
		$q     = [ '@type' => 'Question', 'name' => $a['title'], 'acceptedAnswer' => [ '@type' => 'Answer', 'text' => $a['answer'] ? $a['answer'] : ( $first ? $first : $a['summary'] ) ] ];
		if ( $a['q'] ) {
			$q['alternateName'] = $a['q'];
		}
		$main = $base + [ '@type' => 'FAQPage', '@id' => $url . '#faq', 'name' => $a['title'], 'mainEntity' => [ $q ] ];
	}
	if ( ! $main ) {
		$main = $base + [ '@type' => 'TechArticle', '@id' => $url . '#article', 'headline' => $a['title'], 'description' => $desc, 'mainEntityOfPage' => $url, 'author' => [ '@id' => home_url( '/#organization' ) ] ];
		if ( $cat ) {
			$main['articleSection'] = $cat['name'];
		}
		$main['about'] = [ '@type' => 'SoftwareApplication', 'name' => 'Personalisation Hub', 'applicationCategory' => 'BusinessApplication' ];
	}
	$trail = [];
	if ( $cat ) {
		$trail[] = [ $cat['name'], cat_url( $cat ) ];
	}
	$trail[] = [ $a['title'], $url ];
	return [ $main, crumbs( $trail ), org(), software() ];
}

function ld_graph( $v ) {
	if ( 'article' === $v['type'] ) {
		return article_ld( $v['art'] );
	}
	if ( 'category' === $v['type'] ) {
		$c     = $v['cat'];
		$items = [];
		foreach ( arts_under( $c['id'] ) as $i => $a ) {
			$items[] = [ '@type' => 'ListItem', 'position' => $i + 1, 'name' => $a['title'], 'url' => art_url( $a ) ];
		}
		return [ [ '@type' => 'CollectionPage', '@id' => cat_url( $c ) . '#page', 'name' => $c['name'], 'description' => $c['desc'], 'url' => cat_url( $c ), 'inLanguage' => 'en-GB', 'isPartOf' => [ '@type' => 'WebSite', 'name' => SITE_NAME, 'url' => base_url() ], 'mainEntity' => [ '@type' => 'ItemList', 'itemListElement' => $items ] ], crumbs( [ [ $c['name'], cat_url( $c ) ] ] ), org(), software() ];
	}
	if ( 'front' === $v['type'] ) {
		$items = [];
		foreach ( top_cats() as $i => $c ) {
			$items[] = [ '@type' => 'ListItem', 'position' => $i + 1, 'name' => $c['name'], 'url' => cat_url( $c ) ];
		}
		return [
			[ '@type' => 'WebSite', '@id' => base_url() . '#site', 'name' => SITE_NAME, 'url' => base_url(), 'inLanguage' => 'en-GB', 'publisher' => [ '@id' => home_url( '/#organization' ) ], 'potentialAction' => [ '@type' => 'SearchAction', 'target' => [ '@type' => 'EntryPoint', 'urlTemplate' => base_url( 'search/' ) . '?q={search_term_string}' ], 'query-input' => 'required name=search_term_string' ] ],
			[ '@type' => 'CollectionPage', '@id' => base_url() . '#page', 'name' => SITE_NAME, 'description' => 'Set-up guides, how-tos and reference for the Personalisation Hub platform.', 'url' => base_url(), 'isPartOf' => [ '@id' => base_url() . '#site' ], 'mainEntity' => [ '@type' => 'ItemList', 'itemListElement' => $items ] ],
			org(),
			software(),
		];
	}
	return null;
}

/* ---------- routing, gating and rendering ---------- */
function view( $set = null ) {
	static $v = null;
	if ( null !== $set ) {
		$v = $set;
	}
	return $v;
}

/** Where a retired or unknown console article id should land: the article, else its category, else the Support Centre home. */
function article_target( $cid ) {
	if ( ! safe_id( $cid ) ) {
		return base_url();
	}
	$a = art_by_cid( $cid );
	if ( $a ) {
		return art_url( $a );
	}
	$gone = get_posts( [ 'post_type' => PT, 'post_status' => [ 'draft', 'pending', 'private' ], 'numberposts' => 1, 'meta_key' => 'ph_help_id', 'meta_value' => $cid, 'suppress_filters' => true ] ); // phpcs:ignore WordPress.DB.SlowDBQuery
	if ( $gone ) {
		$t   = get_the_terms( $gone[0], TAX );
		$top = ( $t && ! is_wp_error( $t ) ) ? parent_cat( (int) $t[0]->term_id ) : null;
		if ( $top ) {
			return cat_url( $top );
		}
	}
	return base_url();
}

/** Legacy Help Centre paths under /support-centre/ (the old help domain forwards here): one 301 to the matching page. */
function legacy_target( $rel ) {
	$p   = substr( $rel, strlen( BASE ) + 1 );
	$get = function ( $k ) {
		return isset( $_GET[ $k ] ) ? sanitize_text_field( wp_unslash( $_GET[ $k ] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
	};
	if ( 'index.html' === $p ) {
		return base_url();
	}
	if ( 'search.html' === $p ) {
		$q = mb_substr( trim( $get( 'q' ) ), 0, 200 );
		return base_url( 'search/' ) . ( '' !== $q ? '?q=' . rawurlencode( $q ) : '' );
	}
	if ( 'article.html' === $p ) {
		return article_target( $get( 'id' ) );
	}
	if ( 'category.html' === $p ) {
		$c = cat_by_cid( $get( 'id' ) );
		return $c ? cat_url( $c ) : base_url();
	}
	if ( preg_match( '#^support/solutions/articles/(\d+)#', $p, $m ) ) {
		return article_target( 'faq-art-' . $m[1] );
	}
	if ( 'support' === $p || str_starts_with( $p, 'support/' ) || str_starts_with( $p, 'data/' ) ) {
		return base_url();
	}
	return null;
}

function gate_404() {
	global $wp_query;
	$wp_query->set_404();
	status_header( 404 );
	nocache_headers();
	remove_action( 'template_redirect', 'redirect_canonical' );
	add_filter( 'do_redirect_guess_404_permalink', '__return_false' );
}

add_action( 'template_redirect', function () {
	$raw   = (string) wp_parse_url( wp_unslash( $_SERVER['REQUEST_URI'] ?? '/' ), PHP_URL_PATH ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	$home  = rtrim( (string) wp_parse_url( home_url( '/' ), PHP_URL_PATH ), '/' );
	$rel   = trim( substr( $raw, strlen( $home ) ), '/' );
	$under = BASE === $rel || str_starts_with( $rel, BASE . '/' );
	if ( ! $under ) {
		if ( is_singular( PT ) || is_tax( TAX ) ) {
			if ( ! active() ) {
				gate_404();
				return;
			}
			$o = get_queried_object();
			wp_safe_redirect( is_singular( PT ) ? get_permalink( $o ) : get_term_link( $o ), 301 );
			exit;
		}
		return;
	}
	$search = is_page( PAGE_ID ) && 'search' === get_query_var( 'ph_help_view' );
	if ( ! active() ) {
		if ( ! is_page( PAGE_ID ) || $search ) {
			gate_404();
		}
		return;
	}
	$legacy = BASE !== $rel ? legacy_target( $rel ) : null;
	if ( $legacy ) {
		wp_safe_redirect( $legacy, 301 );
		exit;
	}
	if ( '/' !== substr( $raw, -1 ) ) {
		$qs = isset( $_SERVER['QUERY_STRING'] ) ? (string) wp_unslash( $_SERVER['QUERY_STRING'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		wp_safe_redirect( home_url( '/' . $rel . '/' ) . ( '' !== $qs ? '?' . $qs : '' ), 301 );
		exit;
	}
	$keep = isset( $_GET['release'] ) ? '?release=' . rawurlencode( sanitize_text_field( wp_unslash( $_GET['release'] ) ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
	if ( $search ) {
		$q = isset( $_GET['q'] ) ? mb_substr( trim( sanitize_text_field( wp_unslash( $_GET['q'] ) ) ), 0, 200 ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		view( [ 'type' => 'search', 'q' => $q ] );
	} elseif ( is_page( PAGE_ID ) ) {
		view( [ 'type' => 'front' ] );
	} elseif ( is_singular( PT ) ) {
		$a = catalogue()['arts'][ get_queried_object_id() ] ?? null;
		if ( ! $a || ! in_release( $a ) ) {
			view( [ 'type' => 'notfound' ] );
		} else {
			$top = parent_cat( $a['cat'] );
			if ( $top && get_query_var( 'ph_help_catpath' ) !== $top['slug'] ) {
				wp_safe_redirect( art_url( $a ) . $keep, 301 );
				exit;
			}
			view( [ 'type' => 'article', 'art' => $a ] );
		}
	} elseif ( is_tax( TAX ) ) {
		$c = cats()[ get_queried_object_id() ] ?? null;
		if ( $c && $c['parent'] ) {
			wp_safe_redirect( cat_url( $c ), 301 );
			exit;
		}
		view( $c ? [ 'type' => 'category', 'cat' => $c ] : [ 'type' => 'notfound' ] );
	} else {
		/* Unpublished or retired article: 301 to its category, never a dead end. */
		$seg = explode( '/', $rel );
		if ( 3 === count( $seg ) ) {
			$gone = get_posts( [ 'post_type' => PT, 'name' => sanitize_title( $seg[2] ), 'post_status' => [ 'draft', 'pending', 'private', 'future' ], 'numberposts' => 1, 'suppress_filters' => true ] );
			if ( $gone ) {
				$t   = get_the_terms( $gone[0], TAX );
				$top = ( $t && ! is_wp_error( $t ) ) ? parent_cat( (int) $t[0]->term_id ) : null;
				wp_safe_redirect( $top ? cat_url( $top ) : base_url(), 301 );
				exit;
			}
		}
		view( [ 'type' => 'notfound' ] );
	}
	remove_action( 'template_redirect', 'redirect_canonical' );
	$v = view();
	if ( ! LIVE || '' !== $keep || in_array( $v['type'], [ 'search', 'notfound' ], true ) ) {
		header( 'X-Robots-Tag: noindex, follow' );
	}
	if ( isset( $_GET['format'] ) && 'md' === sanitize_key( wp_unslash( $_GET['format'] ) ) && in_array( $v['type'], [ 'front', 'category', 'article' ], true ) ) { // phpcs:ignore WordPress.Security.NonceVerification
		status_header( 200 );
		header( 'Content-Type: text/markdown; charset=utf-8' );
		header( 'X-Robots-Tag: noindex' );
		echo markdown( $v ); // phpcs:ignore WordPress.Security.EscapeOutput -- plain-text markdown.
		exit;
	}
	if ( 'notfound' === $v['type'] || ! LIVE ) {
		nocache_headers();
	}
	/* Render through the normal template step, after every plugin's template_redirect work (Elementor fonts and icons for the header, Site Kit's tag). */
	add_filter( 'template_include', function () {
		return __DIR__ . '/sc-template.php';
	}, PHP_INT_MAX );
}, 5 );

/* ---------- head: titles, JSON-LD, markdown link, assets ---------- */
$title = function ( $t ) {
	$v = view();
	if ( ! $v ) {
		return $t;
	}
	if ( 'search' === $v['type'] ) {
		return esc_html( ( '' !== $v['q'] ? 'Search: ' . $v['q'] : 'Search results' ) . ' | ' . SITE_NAME );
	}
	if ( 'notfound' === $v['type'] ) {
		return 'Article not found | ' . SITE_NAME;
	}
	return $t;
};
add_filter( 'pre_get_document_title', $title, 999 );
add_filter( 'seopress_titles_title', $title, 999 );
add_filter( 'seopress_titles_canonical', function ( $c ) {
	$v = view();
	return ( $v && in_array( $v['type'], [ 'search', 'notfound' ], true ) ) ? '' : $c;
}, 999 );

add_filter( 'body_class', function ( $c ) {
	if ( view() ) {
		$c[] = 'ph-sc-body';
	}
	return $c;
} );

add_action( 'wp_head', function () {
	$v = view();
	if ( ! $v ) {
		return;
	}
	$graph = ld_graph( $v );
	if ( $graph ) {
		echo '<script type="application/ld+json">' . wp_json_encode( [ '@context' => 'https://schema.org', '@graph' => $graph ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG ) . '</script>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput
	}
	$md = [ 'front' => base_url(), 'category' => isset( $v['cat'] ) ? cat_url( $v['cat'] ) : '', 'article' => isset( $v['art'] ) ? art_url( $v['art'] ) : '' ][ $v['type'] ] ?? '';
	if ( $md ) {
		echo '<link rel="alternate" type="text/markdown" href="' . esc_url( md_url( $md ) ) . '">' . "\n";
	}
}, 21 );

add_action( 'wp_enqueue_scripts', function () {
	if ( ! view() ) {
		return;
	}
	/* Roboto comes from Elementor's local fonts on every page; no third-party font request from this snippet. */
	wp_enqueue_style( 'ph-sc-10156', angie_cs_get_snippet_asset_url( __FILE__, 'sc.css' ), [], VER );
	wp_enqueue_script( 'ph-sc-10156', angie_cs_get_snippet_asset_url( __FILE__, 'sc.js' ), [], VER, [ 'in_footer' => true, 'strategy' => 'defer' ] );
}, 20 );

/* ---------- agents: /llms.txt section and sitemap (live only) ---------- */
add_filter( 'ph_llms_txt', function ( $txt ) {
	if ( ! LIVE ) {
		return $txt;
	}
	$md = "## Support Centre\n\n- [" . SITE_NAME . '](' . md_url( base_url() ) . "): set-up guides, how-tos and reference for the Personalisation Hub platform.\n";
	$md .= "- [Help search API](" . HELP_API . "/search?q=add%20a%20store): search the Support Centre by keyword or plain question; returns JSON with each article's URL. Read an article as markdown by adding ?format=md to its URL.\n";
	$md .= "- [Help MCP server](" . HELP_API . "/mcp): read-only MCP endpoint (streamable HTTP) with the tools search_help and get_help_article.\n";
	$md .= "- On Support Centre pages, browsers with WebMCP also expose search_help and get_help_article to in-browser agents.\n";
	foreach ( top_cats() as $c ) {
		$list = arts_under( $c['id'] );
		if ( $list ) {
			$md .= "\n### " . $c['name'] . "\n\n" . md_list( $list );
		}
	}
	return rtrim( $txt ) . "\n\n" . $md;
}, 20 );

add_filter( 'option_seopress_xml_sitemap_option_name', function ( $o ) {
	if ( LIVE && is_array( $o ) ) {
		$o['seopress_xml_sitemap_post_types_list']        = (array) ( $o['seopress_xml_sitemap_post_types_list'] ?? [] );
		$o['seopress_xml_sitemap_post_types_list'][ PT ] = [ 'include' => '1' ];
	}
	return $o;
} );
