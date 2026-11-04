<?php
/**
 * PH Agent Endpoint: the shared tool contract (design guide s.4). Pure PHP, no
 * WordPress calls, so tests run offline. The WordPress glue in main.php
 * supplies a "source" (callables that read live published content); the WebMCP
 * loader and the remote MCP server both call the REST endpoint that runs this.
 */
namespace AngieSnippets\PhAgentEndpoint___ID__;

const INDUSTRY_SLUGS = array( 'convenience', 'hospitality', 'telco', 'pharmacy', 'retail-media', 'grocery', 'fashion', 'qsr', 'banking' );
const SC_BASE_PATH   = '/support-centre/';

/** The tracked CTA hop (ticket 5, RevOps): /go/<slug>/ records a click and 302s to the exact link below. The target is never read from the request. */
function go_targets() {
	return array( 'free-trial' => FREE_TRIAL_URL, 'demo' => DEMO_URL );
}

/** Where a request path leads, or null: only /go/free-trial/ and /go/demo/ exist. */
function go_target( $path ) {
	$p = rtrim( (string) parse_url( (string) $path, PHP_URL_PATH ), '/' );
	if ( 0 !== strpos( $p, '/go/' ) ) {
		return null;
	}
	$slug = substr( $p, 4 );
	return isset( go_targets()[ $slug ] ) ? array( $slug, go_targets()[ $slug ] ) : null;
}

/** Requests per address per minute on the public tool routes and on the CTA hop (pen test PT-04). Filterable in main.php. */
const RATE_TOOLS_MAX = 120;
const RATE_CTA_MAX   = 30;

/** Seconds to wait when $count requests have been seen in the current window and $max is the limit, else 0. */
function rate_wait( $count, $max, $window_left ) {
	return $count > $max ? max( 1, (int) $window_left ) : 0;
}

/** Stable form of decoded args for a cache key: sorted keys, so {"a":1,"b":2} and {"b":2,"a":1} share one entry. */
function args_key( array $args ) {
	ksort( $args );
	return json_encode( $args, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
}

/** Which surface sent the agent: only these two values are ever recorded, anything else is plain "agent". */
function go_via( $raw ) {
	return in_array( $raw, array( 'webmcp', 'remote-mcp' ), true ) ? $raw : 'agent';
}

/** The tracked link a tool result carries for a CTA slug, for a source. */
function tracked_url( $slug, $via = 'webmcp' ) {
	return PH_AE_SITE . '/go/' . $slug . '/?via=' . go_via( $via );
}

/** Host of a referrer or origin header, lower case, or null. Never the path or query. */
function referrer_host( $ref ) {
	$h = parse_url( trim( (string) $ref ), PHP_URL_HOST );
	return ( is_string( $h ) && '' !== $h && strlen( $h ) <= 100 ) ? strtolower( $h ) : null;
}

/** One agent CTA click: nothing but the CTA, source, referrer host and time. No IP, user agent, query or free text. */
function cta_event( $slug, $via, $referrer, $time ) {
	return array( 'event' => 'ph_agent_cta', 'cta' => $slug, 'source' => go_via( $via ), 'agent' => true, 'referrer' => referrer_host( $referrer ), 'at' => gmdate( 'c', (int) $time ) );
}

/** Feature slugs, from the allow-list (one source of truth). */
function feature_slugs() {
	$out = array();
	foreach ( ids_of_kind( 'feature' ) as $id ) {
		$out[ $id ] = trim( page_url( $id ) === '' ? '' : (string) parse_url( page_url( $id ), PHP_URL_PATH ), '/' );
	}
	return $out;
}

function tool_defs() {
	$none = array( 'type' => 'object', 'properties' => new \stdClass(), 'additionalProperties' => false );
	$ro   = array( 'readOnlyHint' => true );
	return array(
		array(
			'name'        => 'describe_platform',
			'description' => 'What Personalisation Hub is, its product areas with links, how it is deployed and how to start a free trial.',
			'inputSchema' => $none,
			'annotations' => $ro,
		),
		array(
			'name'        => 'list_industries',
			'description' => 'List the industries Personalisation Hub has pages for, with a one-line summary and URL each.',
			'inputSchema' => $none,
			'annotations' => $ro,
		),
		array(
			'name'        => 'get_industry',
			'description' => 'Read one industry page as markdown.',
			'inputSchema' => array(
				'type'                 => 'object',
				'properties'           => array( 'slug' => array( 'type' => 'string', 'enum' => INDUSTRY_SLUGS, 'description' => 'Industry slug from list_industries' ) ),
				'required'             => array( 'slug' ),
				'additionalProperties' => false,
			),
			'annotations' => $ro,
		),
		array(
			'name'        => 'get_feature',
			'description' => 'Read one product feature page as markdown.',
			'inputSchema' => array(
				'type'                 => 'object',
				'properties'           => array( 'slug' => array( 'type' => 'string', 'enum' => array_values( feature_slugs() ), 'description' => 'Feature page slug' ) ),
				'required'             => array( 'slug' ),
				'additionalProperties' => false,
			),
			'annotations' => $ro,
		),
		array(
			'name'        => 'search_help',
			'description' => 'Search the Personalisation Hub Support Centre (set-up guides, how-tos and reference). Plain questions work. Returns matching articles with their URLs.',
			'inputSchema' => array(
				'type'                 => 'object',
				'properties'           => array(
					'query' => array( 'type' => 'string', 'minLength' => 1, 'maxLength' => 200, 'description' => "What to look for, e.g. 'how do I add a store'" ),
					'limit' => array( 'type' => 'integer', 'minimum' => 1, 'maximum' => 20, 'description' => 'Most results to return (default 8)' ),
				),
				'required'             => array( 'query' ),
				'additionalProperties' => false,
			),
			'annotations' => $ro,
		),
		array(
			'name'        => 'get_help_article',
			'description' => 'Read one Personalisation Hub Support Centre article as markdown. Pass the article URL from search_help.',
			'inputSchema' => array(
				'type'                 => 'object',
				'properties'           => array( 'url' => array( 'type' => 'string', 'maxLength' => 300, 'description' => "The article's Support Centre URL" ) ),
				'required'             => array( 'url' ),
				'additionalProperties' => false,
			),
			'annotations' => $ro,
		),
		array(
			'name'        => 'start_free_trial',
			'description' => 'The link to start a free trial of Personalisation Hub on AWS Marketplace.',
			'inputSchema' => $none,
			'annotations' => $ro,
		),
		array(
			'name'        => 'book_demo',
			'description' => 'The link to book a Personalisation Hub demo.',
			'inputSchema' => $none,
			'annotations' => $ro,
		),
	);
}

function tool_def( $name ) {
	foreach ( tool_defs() as $d ) {
		if ( $d['name'] === $name ) {
			return $d;
		}
	}
	return null;
}

/** A CallToolResult. */
function tool_text( $text, ?array $structured = null ) {
	$r = array( 'content' => array( array( 'type' => 'text', 'text' => $text ) ) );
	if ( null !== $structured ) {
		$r['structuredContent'] = $structured;
	}
	return $r;
}

function tool_error( $msg ) {
	return array( 'content' => array( array( 'type' => 'text', 'text' => $msg ) ), 'isError' => true );
}

/**
 * Validate decoded args against a tool's inputSchema (the subset used above).
 * Returns null when fine, else a plain-English message.
 */
function validate_args( array $schema, $args ) {
	if ( ! is_array( $args ) || ( $args && array_keys( $args ) === range( 0, count( $args ) - 1 ) ) ) {
		return 'Arguments must be a JSON object.';
	}
	$props = (array) $schema['properties'];
	foreach ( $schema['required'] ?? array() as $k ) {
		if ( ! array_key_exists( $k, $args ) ) {
			return "Missing required argument: $k.";
		}
	}
	foreach ( $args as $k => $v ) {
		if ( ! array_key_exists( $k, $props ) ) {
			return 'Unknown argument: ' . mb_substr( preg_replace( '/[^\w .\/-]/u', '', (string) $k ), 0, 40 ) . '.';
		}
		$p = $props[ $k ];
		if ( 'string' === $p['type'] ) {
			if ( ! is_string( $v ) ) {
				return "Argument $k must be a string.";
			}
			if ( isset( $p['minLength'] ) && mb_strlen( trim( $v ) ) < $p['minLength'] ) {
				return "Argument $k must not be empty.";
			}
			if ( isset( $p['maxLength'] ) && mb_strlen( $v ) > $p['maxLength'] ) {
				return "Argument $k is too long (most {$p['maxLength']} characters).";
			}
			if ( isset( $p['enum'] ) && ! in_array( $v, $p['enum'], true ) ) {
				return "Unknown $k \"" . mb_substr( preg_replace( '/[^\w .\/-]/u', '', $v ), 0, 40 ) . '". Use one of: ' . implode( ', ', $p['enum'] ) . '.';
			}
		} elseif ( 'integer' === $p['type'] ) {
			if ( ! is_int( $v ) ) {
				return "Argument $k must be a whole number.";
			}
			if ( ( isset( $p['minimum'] ) && $v < $p['minimum'] ) || ( isset( $p['maximum'] ) && $v > $p['maximum'] ) ) {
				return "Argument $k must be between {$p['minimum']} and {$p['maximum']}.";
			}
		}
	}
	return null;
}

/**
 * The normalised /support-centre/... path of a URL or path, or null when it is
 * not one: other hosts, other schemes, other sections, traversal, encoded tricks.
 */
function help_article_path( $url ) {
	$url = trim( (string) $url );
	if ( '' === $url || preg_match( '/[\x00-\x1f\\\\]/', $url ) ) {
		return null;
	}
	$p = parse_url( $url );
	if ( false === $p ) {
		return null;
	}
	if ( isset( $p['scheme'] ) || isset( $p['host'] ) ) {
		$site = parse_url( PH_AE_SITE );
		if ( ! in_array( strtolower( $p['scheme'] ?? '' ), array( 'http', 'https' ), true ) || strtolower( $p['host'] ?? '' ) !== $site['host'] || isset( $p['user'] ) || isset( $p['port'] ) ) {
			return null;
		}
	}
	$path = (string) ( $p['path'] ?? '' );
	if ( preg_match( '/%(2e|2f|5c|00)/i', $path ) || false !== strpos( $path, '..' ) || false !== strpos( $path, '//' ) ) {
		return null;
	}
	if ( 0 !== strpos( $path, SC_BASE_PATH ) || strlen( $path ) <= strlen( SC_BASE_PATH ) ) {
		return null;
	}
	return rtrim( $path, '/' ) . '/';
}

/**
 * Run one tool. $src is an array of callables that read live published content:
 *   pages()           id => [title, summary] for exposable allow-listed pages
 *   page_md(id)       markdown twin or null
 *   industries()      [[slug,title,url,summary]] for live industry pages
 *   industry_md(slug) markdown or null
 *   search(q, limit)  [[title,url,category,folder,summary]] or null when help is off
 *   article_md(path)  markdown or null
 * Returns a CallToolResult; never throws to the caller.
 */
function run_tool( $name, $args, array $src ) {
	$def = tool_def( (string) $name );
	if ( ! $def ) {
		return tool_error( 'Unknown tool. Available tools: ' . implode( ', ', array_column( tool_defs(), 'name' ) ) . '.' );
	}
	$bad = validate_args( $def['inputSchema'], $args );
	if ( null !== $bad ) {
		return tool_error( $bad );
	}
	try {
		switch ( $name ) {
			case 'describe_platform':
				$pages = $src['pages']();
				$home  = $pages[2389] ?? array( 'Personalisation Hub', '' );
				$md    = "# Personalisation Hub\n\n" . ( '' !== trim( $home[1] ) ? trim( $home[1] ) . "\n\n" : '' )
					. 'Personalisation Hub is a self-hosted personalisation platform for businesses with physical locations. It runs in the customer\'s own AWS account, so customer data stays under their control.' . "\n\n## Product areas\n\n";
				$areas = array();
				foreach ( ids_of_kind( 'feature' ) as $id ) {
					if ( isset( $pages[ $id ] ) ) {
						$areas[] = array( 'title' => $pages[ $id ][0], 'url' => page_url( $id ), 'summary' => trim( $pages[ $id ][1] ) );
						$md     .= '- [' . $pages[ $id ][0] . '](' . page_url( $id ) . ')' . ( '' !== trim( $pages[ $id ][1] ) ? ': ' . trim( $pages[ $id ][1] ) : '' ) . "\n";
					}
				}
				$md .= "\n## Deployment\n\nSelf-hosted in the customer's own AWS account.\n\n## Free trial\n\n[Start a free trial on AWS Marketplace](" . FREE_TRIAL_URL . ")\n";
				return tool_text( $md, array( 'name' => 'Personalisation Hub', 'url' => PH_AE_SITE . '/', 'deployment' => "Customer's own AWS account", 'productAreas' => $areas, 'freeTrialUrl' => FREE_TRIAL_URL ) );

			case 'list_industries':
				$rows = array();
				$md   = "# Industries\n\n";
				foreach ( $src['industries']() as $r ) {
					$rows[] = array( 'slug' => $r[0], 'title' => $r[1], 'url' => $r[2], 'summary' => $r[3] );
					$md    .= '- [' . $r[1] . '](' . $r[2] . ')' . ( '' !== $r[3] ? ': ' . $r[3] : '' ) . "\n";
				}
				return tool_text( $md, array( 'industries' => $rows ) );

			case 'get_industry':
				$md = $src['industry_md']( $args['slug'] );
				return null === $md ? tool_error( 'That industry page is not available.' ) : tool_text( $md );

			case 'get_feature':
				$id = array_search( $args['slug'], feature_slugs(), true );
				$md = false === $id ? null : $src['page_md']( $id );
				return null === $md ? tool_error( 'That feature page is not available.' ) : tool_text( $md );

			case 'search_help':
				$limit = $args['limit'] ?? 8;
				$hits  = $src['search']( trim( $args['query'] ), $limit );
				if ( null === $hits ) {
					return tool_error( 'The Support Centre search is not available right now.' );
				}
				$hits = array_slice( $hits, 0, $limit );
				$out  = array();
				$md   = '';
				foreach ( $hits as $h ) {
					$out[] = array( 'title' => $h[0], 'url' => $h[1], 'category' => $h[2], 'folder' => $h[3], 'summary' => $h[4] );
					$md   .= '- [' . $h[0] . '](' . $h[1] . ')' . ( '' !== $h[4] ? ': ' . $h[4] : '' ) . "\n";
				}
				if ( ! $out ) {
					return tool_text( 'No Support Centre articles match "' . trim( $args['query'] ) . '".', array( 'query' => trim( $args['query'] ), 'results' => array() ) );
				}
				return tool_text( $md, array( 'query' => trim( $args['query'] ), 'results' => $out ) );

			case 'get_help_article':
				$path = help_article_path( $args['url'] );
				if ( null === $path ) {
					return tool_error( 'Only Support Centre articles (' . PH_AE_SITE . SC_BASE_PATH . '...) can be read.' );
				}
				$md = $src['article_md']( $path );
				return null === $md ? tool_error( 'No published Support Centre article at that address. Use search_help to find one.' ) : tool_text( $md );

			case 'start_free_trial':
				return tool_text( 'Start a free trial of Personalisation Hub on AWS Marketplace: ' . tracked_url( 'free-trial' ) . ' (redirects to ' . FREE_TRIAL_URL . ')', array( 'url' => FREE_TRIAL_URL, 'trackedUrl' => tracked_url( 'free-trial' ), 'text' => 'Start a free trial on AWS Marketplace' ) );

			case 'book_demo':
				return tool_text( 'Book a Personalisation Hub demo: ' . tracked_url( 'demo' ) . ' (redirects to ' . DEMO_URL . ')', array( 'url' => DEMO_URL, 'trackedUrl' => tracked_url( 'demo' ), 'text' => 'Book a demo' ) );
		}
	} catch ( \Throwable $e ) {
		return tool_error( 'That did not work. Try again later.' );
	}
	return tool_error( 'Unknown tool.' );
}
