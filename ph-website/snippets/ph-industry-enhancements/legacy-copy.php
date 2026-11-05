<?php
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) && ! defined( 'PH_LEGACY_COPY_TEST' ) ) {
	exit;
}

/*
 * One-time content migration (5 Nov 2026) for Elementor V3 widgets the Elementor MCP cannot edit:
 * the home page's Retail Media bullet that said advertisers bid "through their existing DSP" (DSP
 * integration is not live), and the /retail-queue-management/ copy, reframed so a virtual queue is
 * one of many arrival check-in methods. Runs once on init. An element is changed only while it still
 * contains its marker text, so content someone edited since is never overwritten (logged "skipped").
 * Before/after values and the run result are stored in options for rollback.
 */

const LEGACY_COPY_DONE_OPTION     = 'ph_legacy_copy_v1';
const LEGACY_COPY_LOCK_OPTION     = 'ph_legacy_copy_v1_lock';
const LEGACY_COPY_ROLLBACK_OPTION = 'ph_legacy_copy_v1_rollback';

/** mode 'li' replaces only the <li> containing the marker; 'all' replaces the whole setting. */
function legacy_copy_targets() {
	return array(
		array( 'post' => 2389, 'element' => '1253f65', 'setting' => 'editor', 'marker' => 'through their existing DSP', 'mode' => 'li',
			'value' => '<li><strong>Sell to brands directly.</strong> Brand partners book reserved slots and personalised placements with you, and you set the price of every slot.</li>' ),
		array( 'post' => 2711, 'element' => '00329e1', 'setting' => 'editor', 'marker' => 'Check-In (Identify)', 'mode' => 'all',
			'value' => '<p>Arrival Check-In | Virtual Queue Management</p>' ),
		array( 'post' => 2711, 'element' => 'cbd2dbf', 'setting' => 'title', 'marker' => 'Introducing Virtual Queue Management', 'mode' => 'all',
			'value' => 'Virtual Queue Management: Check-In That Personalises Every Visit' ),
		array( 'post' => 2711, 'element' => '16ba2fa', 'setting' => 'editor', 'marker' => 'Stop forcing your customers', 'mode' => 'all',
			'value' => '<p><strong>Stop making customers stand in line.</strong></p><p>A virtual queue is one of the ways Personalisation Hub checks customers in when they arrive in store, alongside appointments, click-and-collect appointments and proximity. New check-in methods keep being added.</p><p>However a customer checks in, that moment identifies them, so the screens, offers and staff conversations that follow are personalised to them, and your campaigns reach the right people in store.</p><p>Customers wait wherever they like instead of in a line, staff see who’s next and why they came, and you gather the insight to staff every store better.</p>' ),
		array( 'post' => 2711, 'element' => '6244832', 'setting' => 'title', 'marker' => 'Queueing: The Gateway', 'mode' => 'all',
			'value' => 'Check-In: The Gateway to Personalised Retail Experiences' ),
		array( 'post' => 2711, 'element' => '8fa8f98', 'setting' => 'editor', 'marker' => 'leveraging queueing as a key touchpoint', 'mode' => 'all',
			'value' => '<p>Checking in is the moment a store visitor becomes a known customer. Joining a virtual queue is one way in. Booking an appointment, arriving for a click-and-collect pickup or being recognised by proximity are others, and the list keeps growing.</p><p>Whichever way a customer checks in, Personalisation Hub identifies them and surfaces the insights that personalise campaigns on connected digital displays, and briefs staff before they greet the customer.</p><p>Personalisation Hub integrates with existing enterprise platforms using Model Context Protocol (MCP) or the platform’s enterprise-grade APIs.</p>' ),
	);
}

/** Replace the setting on element $id (searched recursively). Returns array( status, before, after ); status is changed|skipped|missing. */
function legacy_copy_apply_target( array &$elements, array $t ) {
	foreach ( $elements as &$el ) {
		if ( isset( $el['id'] ) && (string) $el['id'] === $t['element'] ) {
			$cur = isset( $el['settings'][ $t['setting'] ] ) && is_string( $el['settings'][ $t['setting'] ] ) ? $el['settings'][ $t['setting'] ] : '';
			if ( '' === $cur || false === strpos( $cur, $t['marker'] ) ) {
				return array( 'skipped', $cur, $cur );
			}
			if ( 'li' === $t['mode'] ) {
				$new = preg_replace_callback(
					'#<li\b[^>]*>(?:(?!</li>).)*?' . preg_quote( $t['marker'], '#' ) . '.*?</li>#s',
					function () use ( $t ) {
						return $t['value'];
					},
					$cur,
					1,
					$count
				);
				if ( ! $count || null === $new ) {
					return array( 'skipped', $cur, $cur );
				}
			} else {
				$new = $t['value'];
			}
			$el['settings'][ $t['setting'] ] = $new;
			return array( 'changed', $cur, $new );
		}
		if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
			$r = legacy_copy_apply_target( $el['elements'], $t );
			if ( 'missing' !== $r[0] ) {
				return $r;
			}
		}
	}
	return array( 'missing', '', '' );
}

/** Pure core: apply every target for one post to its decoded _elementor_data. Returns array( data, results, changed ). */
function legacy_copy_migrate_data( array $data, array $targets ) {
	$results = array();
	$changed = false;
	foreach ( $targets as $t ) {
		list( $status, $before, $after ) = legacy_copy_apply_target( $data, $t );
		$results[]                       = array( 'post' => $t['post'], 'element' => $t['element'], 'setting' => $t['setting'], 'status' => $status, 'before' => $before, 'after' => $after );
		if ( 'changed' === $status ) {
			$changed = true;
		}
	}
	return array( $data, $results, $changed );
}

function legacy_copy_clear_caches( $post_id ) {
	delete_post_meta( $post_id, '_elementor_css' );
	delete_post_meta( $post_id, '_elementor_element_cache' );
	if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->files_manager ) ) {
		\Elementor\Plugin::$instance->files_manager->clear_cache();
	}
}

function legacy_copy_run() {
	if ( get_option( LEGACY_COPY_DONE_OPTION ) ) {
		return;
	}
	// add_option fails when the row exists: atomic, so two requests cannot both run the migration.
	if ( ! add_option( LEGACY_COPY_LOCK_OPTION, (string) time(), '', 'no' ) ) {
		return;
	}
	$all      = array();
	$by_post  = array();
	foreach ( legacy_copy_targets() as $t ) {
		$by_post[ $t['post'] ][] = $t;
	}
	foreach ( $by_post as $post_id => $targets ) {
		$raw  = get_post_meta( $post_id, '_elementor_data', true );
		$data = is_string( $raw ) ? json_decode( $raw, true ) : $raw;
		if ( ! is_array( $data ) ) {
			foreach ( $targets as $t ) {
				$all[] = array( 'post' => $post_id, 'element' => $t['element'], 'setting' => $t['setting'], 'status' => 'missing', 'before' => '', 'after' => '' );
			}
			continue;
		}
		list( $data, $results, $changed ) = legacy_copy_migrate_data( $data, $targets );
		if ( $changed ) {
			update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $data ) ) );
			legacy_copy_clear_caches( $post_id );
		}
		$all = array_merge( $all, $results );
	}
	update_option( LEGACY_COPY_ROLLBACK_OPTION, $all, false );
	update_option(
		LEGACY_COPY_DONE_OPTION,
		array(
			'ran_at'  => gmdate( 'c' ),
			'changed' => count( array_filter( $all, function ( $r ) { return 'changed' === $r['status']; } ) ),
			'skipped' => count( array_filter( $all, function ( $r ) { return 'skipped' === $r['status']; } ) ),
			'missing' => count( array_filter( $all, function ( $r ) { return 'missing' === $r['status']; } ) ),
		),
		false
	);
	delete_option( LEGACY_COPY_LOCK_OPTION );
}

if ( function_exists( 'add_action' ) && ! defined( 'PH_LEGACY_COPY_TEST' ) ) {
	add_action( 'init', __NAMESPACE__ . '\\legacy_copy_run', 20 );
}
