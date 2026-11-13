<?php
namespace AngieSnippets\PhIndustryEnhancements_10063;

if ( ! defined( 'ABSPATH' ) && ! defined( 'PH_LEGACY_COPY_TEST' ) ) {
	exit;
}

/*
 * One-time content migration (13 Nov 2026): adds the Android logo (Media Library attachment 10775) to
 * the partner logo ticker, an Elementor V3 Image Carousel the Elementor MCP cannot edit, on the 9 pages
 * that show it. Same shape as legacy-copy.php / -v2 / -v3: runs once on init behind an atomic
 * add_option lock, per-post _elementor_data read-modify-write, Elementor and page cache cleared.
 *
 * For each { post, element }: the element must be widgetType image-carousel; in settings.carousel the
 * item whose url contains ChromeOS-1 is found and a copy of it (every key kept) is inserted straight
 * after it with id 10775 and the Android url. alt is left as the ChromeOS item has it, so an empty alt
 * still reads the attachment's own ("Runs on Android"). A target is "skipped" when the element or the
 * ChromeOS item is missing, the element is not an image carousel, settings.carousel is not an array,
 * the post has no _elementor_data, or an item with id 10775 (or the Android url) is already there, so a re-run changes nothing.
 * Options: ph_legacy_logos_v1 (run result), ph_legacy_logos_v1_lock, ph_legacy_logos_v1_rollback
 * (the carousel's before and after value per target).
 */

const LEGACY_LOGOS_DONE_OPTION     = 'ph_legacy_logos_v1';
const LEGACY_LOGOS_LOCK_OPTION     = 'ph_legacy_logos_v1_lock';
const LEGACY_LOGOS_ROLLBACK_OPTION = 'ph_legacy_logos_v1_rollback';
const LEGACY_LOGOS_ANDROID_ID      = 10775;
const LEGACY_LOGOS_ANDROID_URL     = 'https://personalisationhub.com/wp-content/uploads/2026/11/Android-logo.webp';
const LEGACY_LOGOS_AFTER_MARKER    = 'ChromeOS-1';

function legacy_logos_targets() {
	return array(
		array( 'post' => 2389, 'element' => '4075c9a' ),  // /
		array( 'post' => 7020, 'element' => '291c004' ),  // /digital-signage/
		array( 'post' => 6254, 'element' => '291c004' ),  // /ai-agents/
		array( 'post' => 3973, 'element' => '3252ac0' ),  // /localisation-geo-targeting/
		array( 'post' => 3566, 'element' => '800a2a8' ),  // /personalisation/
		array( 'post' => 3477, 'element' => 'bdb125d' ),  // /store-sites/
		array( 'post' => 3266, 'element' => 'ef54277' ),  // /white-label-retail-media-platform/
		array( 'post' => 3035, 'element' => '78ee9c80' ), // /retail-appointment-bookings/
		array( 'post' => 2711, 'element' => '291c004' ),  // /retail-queue-management/
	);
}

/** True when the carousel already holds the Android logo (by attachment id or url). */
function legacy_logos_has_android( array $items ) {
	foreach ( $items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}
		if ( isset( $item['id'] ) && (string) $item['id'] === (string) LEGACY_LOGOS_ANDROID_ID ) {
			return true;
		}
		if ( isset( $item['url'] ) && is_string( $item['url'] ) && false !== strpos( $item['url'], 'Android-logo' ) ) {
			return true;
		}
	}
	return false;
}

/** Apply one target. Returns array( status, before, after, reason ); status is changed|skipped, or missing (internal: not in this subtree). */
function legacy_logos_apply_target( array &$elements, array $t ) {
	foreach ( $elements as &$el ) {
		if ( ! is_array( $el ) ) {
			continue;
		}
		if ( isset( $el['id'] ) && (string) $el['id'] === (string) $t['element'] ) {
			if ( ! isset( $el['widgetType'] ) || 'image-carousel' !== $el['widgetType'] ) {
				return array( 'skipped', null, null, 'not an image-carousel' );
			}
			if ( ! isset( $el['settings']['carousel'] ) || ! is_array( $el['settings']['carousel'] ) ) {
				return array( 'skipped', null, null, 'settings.carousel is not an array' );
			}
			$before = $el['settings']['carousel'];
			if ( legacy_logos_has_android( $before ) ) {
				return array( 'skipped', $before, $before, 'Android logo already present' );
			}
			$items = array_values( $before );
			$at    = null;
			foreach ( $items as $i => $item ) {
				if ( is_array( $item ) && isset( $item['url'] ) && is_string( $item['url'] ) && false !== strpos( $item['url'], LEGACY_LOGOS_AFTER_MARKER ) ) {
					$at = $i;
					break;
				}
			}
			if ( null === $at ) {
				return array( 'skipped', $before, $before, 'ChromeOS item not found' );
			}
			$new        = $items[ $at ];
			$new['id']  = is_string( $items[ $at ]['id'] ?? null ) ? (string) LEGACY_LOGOS_ANDROID_ID : LEGACY_LOGOS_ANDROID_ID;
			$new['url'] = LEGACY_LOGOS_ANDROID_URL;
			array_splice( $items, $at + 1, 0, array( $new ) );
			$el['settings']['carousel'] = $items;
			return array( 'changed', $before, $items, '' );
		}
		if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
			$r = legacy_logos_apply_target( $el['elements'], $t );
			if ( 'missing' !== $r[0] ) {
				return $r;
			}
		}
	}
	return array( 'missing', null, null, 'element not found' );
}

/** Pure core: apply every target for one post to its decoded _elementor_data. Returns array( data, results, changed ). */
function legacy_logos_migrate_data( array $data, array $targets ) {
	$results = array();
	$changed = false;
	foreach ( $targets as $t ) {
		list( $status, $before, $after, $reason ) = legacy_logos_apply_target( $data, $t );
		if ( 'missing' === $status ) {
			$status = 'skipped'; // element not found anywhere in the tree
		}
		$results[] = array( 'post' => $t['post'], 'element' => $t['element'], 'status' => $status, 'reason' => $reason, 'before' => $before, 'after' => $after );
		if ( 'changed' === $status ) {
			$changed = true;
		}
	}
	return array( $data, $results, $changed );
}

/** Restore a decoded _elementor_data to the before value recorded for one target. Returns the data, unchanged when the element is gone. */
function legacy_logos_rollback_data( array $data, array $row ) {
	if ( ! isset( $row['status'] ) || 'changed' !== $row['status'] || ! is_array( $row['before'] ) ) {
		return $data;
	}
	$walk = function ( array &$nodes ) use ( &$walk, $row ) {
		foreach ( $nodes as &$el ) {
			if ( ! is_array( $el ) ) {
				continue;
			}
			if ( isset( $el['id'] ) && (string) $el['id'] === (string) $row['element'] ) {
				$el['settings']['carousel'] = $row['before'];
				return true;
			}
			if ( ! empty( $el['elements'] ) && is_array( $el['elements'] ) && $walk( $el['elements'] ) ) {
				return true;
			}
		}
		return false;
	};
	$walk( $data );
	return $data;
}

function legacy_logos_clear_caches( $post_id ) {
	legacy_copy_v2_clear_caches( $post_id );
	if ( function_exists( 'clean_post_cache' ) ) {
		clean_post_cache( $post_id );
	}
}

function legacy_logos_run() {
	if ( get_option( LEGACY_LOGOS_DONE_OPTION ) ) {
		return;
	}
	// add_option fails when the row exists: atomic, so two requests cannot both run the migration.
	if ( ! add_option( LEGACY_LOGOS_LOCK_OPTION, (string) time(), '', 'no' ) ) {
		return;
	}
	$all     = array();
	$by_post = array();
	foreach ( legacy_logos_targets() as $t ) {
		$by_post[ $t['post'] ][] = $t;
	}
	foreach ( $by_post as $post_id => $targets ) {
		$raw  = get_post_meta( $post_id, '_elementor_data', true );
		$data = is_string( $raw ) ? json_decode( $raw, true ) : $raw;
		if ( ! is_array( $data ) ) {
			foreach ( $targets as $t ) {
				$all[] = array( 'post' => $post_id, 'element' => $t['element'], 'status' => 'skipped', 'reason' => 'no _elementor_data', 'before' => null, 'after' => null );
			}
			continue;
		}
		list( $data, $results, $changed ) = legacy_logos_migrate_data( $data, $targets );
		if ( $changed ) {
			update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $data ) ) );
			legacy_logos_clear_caches( $post_id );
		}
		$all = array_merge( $all, $results );
	}
	update_option( LEGACY_LOGOS_ROLLBACK_OPTION, $all, false );
	update_option(
		LEGACY_LOGOS_DONE_OPTION,
		array(
			'ran_at'  => gmdate( 'c' ),
			'applied' => count( array_filter( $all, function ( $r ) { return 'changed' === $r['status']; } ) ),
			'skipped' => count( array_filter( $all, function ( $r ) { return 'skipped' === $r['status']; } ) ),
			'results' => array_map( function ( $r ) { return $r['post'] . ':' . $r['element'] . ' ' . $r['status'] . ( '' === $r['reason'] ? '' : ' (' . $r['reason'] . ')' ); }, $all ),
		),
		false
	);
	delete_option( LEGACY_LOGOS_LOCK_OPTION );
}

if ( function_exists( 'add_action' ) && ! defined( 'PH_LEGACY_COPY_TEST' ) ) {
	add_action( 'init', __NAMESPACE__ . '\legacy_logos_run', 23 );
}
