<?php
/**
 * PH Blog abilities (WordPress Abilities API, exposed through the MCP Adapter): upload an image, create a post, update a post.
 * Authenticated, admin-only writes. No public route. Validation lives in pure functions (no WordPress calls) so tests/ph-blog-abilities.test.php runs offline.
 */

namespace AngieSnippets\PhBlog_10116;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const UP_MAX_BYTES   = 15728640; // 15 MB
const UP_TIMEOUT     = 30;
const UP_MIME        = [ 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp' ];
const POST_MAX_CHARS = 100000;

/* ---------- pure validation ---------- */

/** Input schemas (JSON Schema subset: type, minLength, maxLength, enum, required, additionalProperties). */
function schema_for( $which ) {
	$post = [
		'title'             => [ 'type' => 'string', 'minLength' => 1, 'maxLength' => 200 ],
		'slug'              => [ 'type' => 'string', 'minLength' => 1, 'maxLength' => 200 ],
		'excerpt'           => [ 'type' => 'string', 'maxLength' => 400 ],
		'content'           => [ 'type' => 'string', 'minLength' => 1, 'maxLength' => POST_MAX_CHARS ],
		'category'          => [ 'type' => 'string', 'minLength' => 1, 'maxLength' => 200 ],
		'status'            => [ 'type' => 'string', 'enum' => [ 'publish', 'draft' ], 'default' => 'draft' ],
		'featured_media_id' => [ 'type' => 'integer', 'minimum' => 1 ],
	];
	switch ( $which ) {
		case 'upload':
			return [
				'type'                 => 'object',
				'properties'           => [
					'url'      => [ 'type' => 'string', 'maxLength' => 2000 ],
					'alt'      => [ 'type' => 'string', 'minLength' => 1, 'maxLength' => 250 ],
					'filename' => [ 'type' => 'string', 'maxLength' => 120 ],
					'title'    => [ 'type' => 'string', 'maxLength' => 200 ],
				],
				'required'             => [ 'url', 'alt' ],
				'additionalProperties' => false,
			];
		case 'create':
			return [
				'type'                 => 'object',
				'properties'           => $post,
				'required'             => [ 'title', 'slug', 'content', 'category' ],
				'additionalProperties' => false,
			];
		default: // update
			return [
				'type'                 => 'object',
				'properties'           => [ 'post_id' => [ 'type' => 'integer', 'minimum' => 1 ] ] + array_diff_key( $post, [ 'status' => 1 ] ) + [ 'status' => [ 'type' => 'string', 'enum' => [ 'publish', 'draft' ] ] ],
				'required'             => [ 'post_id' ],
				'additionalProperties' => false,
			];
	}
}

/** Returns an error message, or null when $in satisfies $schema. */
function validate_input( $in, $schema ) {
	if ( ! is_array( $in ) ) {
		return 'Input must be an object.';
	}
	foreach ( array_keys( $in ) as $k ) {
		if ( ! isset( $schema['properties'][ $k ] ) ) {
			return 'Unknown field: ' . preg_replace( '/[^\w .\/-]/', '', substr( (string) $k, 0, 40 ) ) . '.';
		}
	}
	foreach ( $schema['required'] as $k ) {
		if ( ! array_key_exists( $k, $in ) ) {
			return "Missing required field: $k.";
		}
	}
	foreach ( $in as $k => $v ) {
		$p = $schema['properties'][ $k ];
		if ( 'string' === $p['type'] ) {
			if ( ! is_string( $v ) ) {
				return "$k must be a string.";
			}
			$len = function_exists( 'mb_strlen' ) ? mb_strlen( $v ) : strlen( $v );
			if ( isset( $p['minLength'] ) && $len < $p['minLength'] ) {
				return "$k must be at least {$p['minLength']} characters.";
			}
			if ( isset( $p['maxLength'] ) && $len > $p['maxLength'] ) {
				return "$k must be {$p['maxLength']} characters or fewer.";
			}
			if ( isset( $p['enum'] ) && ! in_array( $v, $p['enum'], true ) ) {
				return "$k must be one of: " . implode( ', ', $p['enum'] ) . '.';
			}
		} elseif ( 'integer' === $p['type'] ) {
			if ( ! is_int( $v ) ) {
				return "$k must be an integer.";
			}
			if ( isset( $p['minimum'] ) && $v < $p['minimum'] ) {
				return "$k must be at least {$p['minimum']}.";
			}
		}
	}
	return null;
}

/** https only, with a host; no credentials in the URL. */
function check_url( $url ) {
	if ( ! is_string( $url ) || '' === $url ) {
		return 'url is required.';
	}
	$p = parse_url( $url );
	if ( ! is_array( $p ) || ! isset( $p['scheme'], $p['host'] ) || 'https' !== strtolower( $p['scheme'] ) || '' === $p['host'] ) {
		return 'url must be an absolute https:// URL.';
	}
	if ( isset( $p['user'] ) || isset( $p['pass'] ) ) {
		return 'url must not contain credentials.';
	}
	return null;
}

/** The slug must already be in its sanitised form. $sanitised is sanitize_title( $slug ). */
function check_slug( $slug, $sanitised, $taken ) {
	if ( ! is_string( $slug ) || '' === $slug || $slug !== $sanitised ) {
		return 'slug must already be sanitised (lowercase letters, numbers and hyphens): use "' . $sanitised . '".';
	}
	if ( $taken ) {
		return "slug \"$slug\" is already used by another post, page or attachment. Choose a different slug.";
	}
	return null;
}

function check_mime( $mime ) {
	return isset( UP_MIME[ $mime ] ) ? null : 'Only JPEG, PNG and WebP images are accepted.';
}

function check_category( $slug, $exists ) {
	return $exists ? null : "category \"$slug\" does not exist. Categories are never created automatically.";
}

/* ---------- WordPress side ---------- */

function slug_taken( $slug, $exclude_id = 0 ) {
	$found = get_posts( [
		'name'           => $slug,
		'post_type'      => [ 'post', 'page', 'attachment' ],
		'post_status'    => [ 'publish', 'future', 'draft', 'pending', 'private', 'inherit', 'trash' ],
		'posts_per_page' => 1,
		'post__not_in'   => $exclude_id ? [ $exclude_id ] : [],
		'fields'         => 'ids',
		'no_found_rows'  => true,
	] );
	return ! empty( $found );
}

function err( $code, $msg ) {
	return new \WP_Error( 'ph_blog_' . $code, $msg, [ 'status' => 400 ] );
}

function upload_image( $in ) {
	$e = validate_input( $in, schema_for( 'upload' ) ) ?? check_url( $in['url'] ?? '' );
	if ( $e ) {
		return err( 'invalid', $e );
	}
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/media.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';

	$cap = function ( $args ) {
		$args['limit_response_size'] = UP_MAX_BYTES;
		return $args;
	};
	add_filter( 'http_request_args', $cap );
	$tmp = download_url( $in['url'], UP_TIMEOUT ); // wp_safe_remote_get: private and loopback hosts are refused
	remove_filter( 'http_request_args', $cap );
	if ( is_wp_error( $tmp ) ) {
		return err( 'download', 'Download failed: ' . $tmp->get_error_message() );
	}
	try {
		$size = @filesize( $tmp );
		if ( false === $size || $size < 1 || $size > UP_MAX_BYTES ) {
			return err( 'size', 'The image is empty or larger than 15 MB.' );
		}
		$info = wp_getimagesize( $tmp );
		$mime = is_array( $info ) && ! empty( $info['mime'] ) ? $info['mime'] : '';
		if ( $e = check_mime( $mime ) ) {
			return err( 'type', $e );
		}
		$base = sanitize_file_name( pathinfo( $in['filename'] ?? '', PATHINFO_FILENAME ) );
		if ( '' === $base || '.' === $base ) {
			$base = 'ph-blog-' . gmdate( 'Ymd-His' );
		}
		$name  = $base . '.' . UP_MIME[ $mime ]; // the extension comes from the detected type, so extension-less signed URLs work
		$check = wp_check_filetype_and_ext( $tmp, $name );
		if ( empty( $check['type'] ) || $check['type'] !== $mime ) {
			return err( 'type', 'The file content does not match an allowed image type.' );
		}
		$title = isset( $in['title'] ) ? sanitize_text_field( $in['title'] ) : '';
		$id    = media_handle_sideload( [ 'name' => $name, 'tmp_name' => $tmp ], 0, '' === $title ? null : $title );
		if ( is_wp_error( $id ) ) {
			return err( 'sideload', 'Could not save the image: ' . $id->get_error_message() );
		}
		update_post_meta( $id, '_wp_attachment_image_alt', sanitize_text_field( $in['alt'] ) );
		$meta = wp_get_attachment_metadata( $id );
		return [
			'id'     => (int) $id,
			'url'    => wp_get_attachment_url( $id ),
			'width'  => (int) ( $meta['width'] ?? $info[0] ?? 0 ),
			'height' => (int) ( $meta['height'] ?? $info[1] ?? 0 ),
			'mime'   => $mime,
		];
	} finally {
		if ( is_string( $tmp ) && file_exists( $tmp ) ) {
			@unlink( $tmp ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		}
	}
}

/** Shared by create and update. Returns the cleaned fields or a WP_Error. $self is the post being updated (0 for create). */
function prepare_post_fields( $in, $self = 0 ) {
	$out = [];
	if ( isset( $in['title'] ) ) {
		$out['post_title'] = sanitize_text_field( $in['title'] );
	}
	if ( isset( $in['slug'] ) ) {
		$e = check_slug( $in['slug'], sanitize_title( $in['slug'] ), slug_taken( $in['slug'], $self ) );
		if ( $e ) {
			return err( 'slug', $e );
		}
		$out['post_name'] = $in['slug'];
	}
	if ( isset( $in['excerpt'] ) ) {
		$out['post_excerpt'] = sanitize_textarea_field( $in['excerpt'] );
	}
	if ( isset( $in['content'] ) ) {
		$out['post_content'] = wp_kses_post( $in['content'] ); // block comments, target and rel survive; script does not
	}
	if ( isset( $in['category'] ) ) {
		$term = get_category_by_slug( $in['category'] );
		if ( $e = check_category( $in['category'], (bool) $term ) ) {
			return err( 'category', $e );
		}
		$out['post_category'] = [ (int) $term->term_id ];
	}
	if ( isset( $in['status'] ) ) {
		$out['post_status'] = $in['status'];
	}
	if ( isset( $in['featured_media_id'] ) ) {
		$att = get_post( $in['featured_media_id'] );
		if ( ! $att || 'attachment' !== $att->post_type || ! wp_attachment_is_image( $att->ID ) ) {
			return err( 'media', 'featured_media_id must be an image in the Media Library.' );
		}
	}
	return $out;
}

/**
 * Read next for a standalone post: the next older post in the Articles list ($posts is newest first, each
 * ['id'=>int,'series'=>string,'part'=>int]). A series post resolves to that series' part 1; the oldest wraps
 * to the newest; never the post itself. Returns an id, or null when there is no other post.
 */
function readnext_pick( $post_id, $posts ) {
	$n   = count( $posts );
	$idx = null;
	foreach ( array_values( $posts ) as $i => $p ) {
		if ( (int) $p['id'] === (int) $post_id ) {
			$idx = $i;
			break;
		}
	}
	if ( null === $idx || $n < 2 ) {
		return null;
	}
	$posts = array_values( $posts );
	$pick  = $posts[ ( $idx + 1 ) % $n ];
	if ( '' !== (string) ( $pick['series'] ?? '' ) ) {
		$first = null;
		foreach ( $posts as $p ) {
			if ( ( $p['series'] ?? '' ) === $pick['series'] && ( null === $first || (int) $p['part'] < (int) $first['part'] ) ) {
				$first = $p;
			}
		}
		$pick = $first;
	}
	return (int) $pick['id'] === (int) $post_id ? null : (int) $pick['id'];
}

/* purge the host's cached /blog/ copy: fires save_post on the listing page */
function refresh_blog( $status ) {
	if ( 'publish' !== $status ) {
		return false;
	}
	$r = wp_update_post( [ 'ID' => BLOG_ID ], true );
	return ! is_wp_error( $r ) && (int) $r > 0;
}

function post_result( $id ) {
	$p    = get_post( $id );
	$cats = wp_get_post_categories( $id, [ 'fields' => 'slugs' ] );
	return [
		'id'                => (int) $id,
		'link'              => get_permalink( $id ),
		'slug'              => $p->post_name,
		'status'            => $p->post_status,
		'category'          => $cats ? $cats[0] : '',
		'featured_media_id' => (int) get_post_thumbnail_id( $id ),
		'blog_refreshed'    => refresh_blog( $p->post_status ),
	];
}

function attach_featured( $post_id, $media_id ) {
	if ( ! current_user_can( 'edit_post', $media_id ) ) {
		return err( 'media', 'You may not use that image.' );
	}
	set_post_thumbnail( $post_id, $media_id );
	$att = get_post( $media_id );
	if ( $att && 0 === (int) $att->post_parent ) {
		wp_update_post( [ 'ID' => $media_id, 'post_parent' => $post_id ] );
	}
	return true;
}

function create_post( $in ) {
	if ( $e = validate_input( $in, schema_for( 'create' ) ) ) {
		return err( 'invalid', $e );
	}
	$f = prepare_post_fields( $in );
	if ( is_wp_error( $f ) ) {
		return $f;
	}
	$f += [
		'post_type'      => 'post',
		'post_status'    => 'draft',
		'post_author'    => get_current_user_id(),
		'comment_status' => 'closed',
		'ping_status'    => 'closed',
	];
	$id = wp_insert_post( wp_slash( $f ), true );
	if ( is_wp_error( $id ) ) {
		return err( 'insert', 'Could not create the post: ' . $id->get_error_message() );
	}
	if ( isset( $in['featured_media_id'] ) ) {
		$r = attach_featured( $id, $in['featured_media_id'] );
		if ( is_wp_error( $r ) ) {
			return $r;
		}
	}
	return post_result( $id );
}

function update_post( $in ) {
	if ( $e = validate_input( $in, schema_for( 'update' ) ) ) {
		return err( 'invalid', $e );
	}
	$id = (int) $in['post_id'];
	$p  = get_post( $id );
	if ( ! $p || 'post' !== $p->post_type ) {
		return err( 'notfound', 'post_id is not a standard post.' );
	}
	if ( count( $in ) < 2 ) {
		return err( 'invalid', 'Nothing to update: send at least one field besides post_id.' );
	}
	$f = prepare_post_fields( $in, $id );
	if ( is_wp_error( $f ) ) {
		return $f;
	}
	if ( $f ) {
		$r = wp_update_post( wp_slash( [ 'ID' => $id ] + $f ), true );
		if ( is_wp_error( $r ) ) {
			return err( 'update', 'Could not update the post: ' . $r->get_error_message() );
		}
	}
	if ( isset( $in['featured_media_id'] ) ) {
		$r = attach_featured( $id, $in['featured_media_id'] );
		if ( is_wp_error( $r ) ) {
			return $r;
		}
	}
	return post_result( $id );
}

/* ---------- registration ---------- */

add_action( 'wp_abilities_api_categories_init', function () {
	if ( function_exists( 'wp_register_ability_category' ) ) {
		wp_register_ability_category( 'ph-blog', [
			'label'       => 'PH Blog',
			'description' => 'Publish blog posts and their images on personalisationhub.com.',
		] );
	}
} );

add_action( 'wp_abilities_api_init', function () {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}
	$result = [
		'type'       => 'object',
		'properties' => [
			'id'                => [ 'type' => 'integer' ],
			'link'              => [ 'type' => 'string' ],
			'slug'              => [ 'type' => 'string' ],
			'status'            => [ 'type' => 'string' ],
			'category'          => [ 'type' => 'string' ],
			'featured_media_id' => [ 'type' => 'integer' ],
		],
	];
	$meta = function ( $idempotent ) {
		return [
			'show_in_rest' => true,
			'mcp'          => [ 'public' => true ],
			'annotations'  => [ 'readonly' => false, 'destructive' => false, 'idempotent' => $idempotent ],
		];
	};
	wp_register_ability( 'ph-blog/upload-image', [
		'label'               => 'Upload blog image',
		'description'         => 'Sideload one JPEG, PNG or WebP image (max 15 MB) from an https URL into the Media Library. Requires alt text. Returns {id, url, width, height, mime}.',
		'category'            => 'ph-blog',
		'input_schema'        => schema_for( 'upload' ),
		'output_schema'       => [ 'type' => 'object', 'properties' => [ 'id' => [ 'type' => 'integer' ], 'url' => [ 'type' => 'string' ], 'width' => [ 'type' => 'integer' ], 'height' => [ 'type' => 'integer' ], 'mime' => [ 'type' => 'string' ] ] ],
		'execute_callback'    => __NAMESPACE__ . '\\upload_image',
		'permission_callback' => function () {
			return current_user_can( 'upload_files' );
		},
		'meta'                => $meta( false ),
	] );
	wp_register_ability( 'ph-blog/create-post', [
		'label'               => 'Create blog post',
		'description'         => 'Create a standard post from Gutenberg block markup. The slug must be unused and already sanitised; the category must exist. Default status is draft. Returns {id, link, slug, status, category, featured_media_id}.',
		'category'            => 'ph-blog',
		'input_schema'        => schema_for( 'create' ),
		'output_schema'       => $result,
		'execute_callback'    => __NAMESPACE__ . '\\create_post',
		'permission_callback' => function () {
			return current_user_can( 'publish_posts' );
		},
		'meta'                => $meta( false ),
	] );
	wp_register_ability( 'ph-blog/update-post', [
		'label'               => 'Update blog post',
		'description'         => 'Update fields of an existing standard post by post_id. Same validation as create-post; a slug used by another object is refused. Returns the same shape as create-post.',
		'category'            => 'ph-blog',
		'input_schema'        => schema_for( 'update' ),
		'output_schema'       => $result,
		'execute_callback'    => __NAMESPACE__ . '\\update_post',
		'permission_callback' => function ( $input = null ) {
			$id = is_array( $input ) && isset( $input['post_id'] ) && is_int( $input['post_id'] ) ? $input['post_id'] : 0;
			return $id > 0 && current_user_can( 'edit_post', $id );
		},
		'meta'                => $meta( true ),
	] );
} );
