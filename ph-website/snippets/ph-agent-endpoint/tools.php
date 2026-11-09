<?php
/**
 * PH Agent Endpoint: the shared tool contract (design guide s.4). Pure PHP, no
 * WordPress calls, so tests run offline. The WordPress glue in main.php
 * supplies a "source" (callables that read live published content); the WebMCP
 * loader and the remote MCP server both call the REST endpoint that runs this.
 */
namespace AngieSnippets\PhAgentEndpoint___ID__;

require_once __DIR__ . '/install-spec.php';

const INDUSTRY_SLUGS = array( 'convenience', 'hospitality', 'telco', 'pharmacy', 'retail-media', 'grocery', 'fashion', 'qsr', 'banking' );
const SC_BASE_PATH   = '/support-centre/';

/**
 * The business model calculators: the Industries snippet owns the one list (ph-industry-enhancements/calculators.php);
 * this snippet only reads it, so a new industry there is listed, described and callable here with no change in this file.
 * Returns [] when that snippet is not loaded, and the tool is then not offered.
 */
const CALC_NS = 'AngieSnippets\\PhIndustryEnhancements_10063\\';

function calc_call( $fn, ...$args ) {
	return function_exists( CALC_NS . $fn ) ? call_user_func_array( CALC_NS . $fn, $args ) : null;
}

function calc_registry() {
	$r = calc_call( 'calculators' );
	return is_array( $r ) ? $r : array();
}

/** The union of every calculator's input ids, as JSON-schema number properties (the tool validates against the chosen industry). */
function calc_input_props( array $cals ) {
	$props = array();
	foreach ( $cals as $e ) {
		foreach ( (array) calc_call( 'calc_inputs', $e ) as $i ) {
			$props[ $i['id'] ] = array( 'type' => 'number', 'description' => $i['label'] . ' (default ' . $i['default'] . ', ' . $i['min'] . ' to ' . $i['max'] . ')' );
		}
	}
	return $props;
}

function calc_tool_def() {
	$cals = calc_registry();
	if ( ! $cals ) {
		return null;
	}
	$names = array();
	foreach ( $cals as $e ) {
		$names[] = $e['name'];
	}
	return array(
		'name'        => 'calculate_business_model',
		'title'       => 'Calculate a business case',
		'description' => 'Estimates what Personalisation Hub could add for a business: a business model and business case calculator. Enter a few figures about a business and get an instant estimate of what Personalisation Hub could add, plus a link to the calculator pre-filled with those figures, where the business model can be downloaded. Supported industries: ' . implode( ', ', $names ) . '. Call with no arguments to list the calculators and the inputs each needs; call with an industry and any inputs you know (the rest use defaults, and the result says which) to get the estimate. The downloadable model is gated: the person must enter their own name, company and work email on the page and agree to be contacted, so give them the link rather than filling that in for them.',
		'inputSchema' => array(
			'type'                 => 'object',
			'properties'           => array(
				'industry' => array( 'type' => 'string', 'enum' => array_keys( $cals ), 'description' => 'Industry slug (' . implode( ', ', array_keys( $cals ) ) . '). Omit to list every calculator.' ),
				'inputs'   => array( 'type' => 'object', 'properties' => calc_input_props( $cals ), 'additionalProperties' => false, 'description' => 'Figures for the chosen industry, by input id. Omitted ones use the default.' ),
			),
			'additionalProperties' => false,
		),
		'annotations' => tool_annotations(),
	);
}

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

/** Every tool only reads (the CTA tools only return links), is safe to repeat and touches nothing outside this site's own content. */
function tool_annotations() {
	return array( 'readOnlyHint' => true, 'idempotentHint' => true, 'openWorldHint' => false );
}

/** Accepted spellings of a feature slug that no longer match the page: old slug => current slug. Keeps clients that cached the old enum working. */
function feature_slug_aliases() {
	return array( 'retail-media-platform' => 'white-label-retail-media-platform' );
}

function tool_defs() {
	$none = array( 'type' => 'object', 'properties' => new \stdClass(), 'additionalProperties' => false );
	$ro   = tool_annotations();
	$defs = array(
		array(
			'name'        => 'describe_platform',
			'title'       => 'Describe Personalisation Hub',
			'description' => 'What Personalisation Hub is: AI-native digital signage, a white-label retail media platform, queue management and appointment booking, mobile store sites and in-store personalisation, self-hosted in the customer\'s own AWS account. Returns the product areas with links, how it is deployed and how to start a free trial. Start here for any general question about the platform.',
			'inputSchema' => $none,
			'annotations' => $ro,
		),
		array(
			'name'        => 'list_industries',
			'title'       => 'List industries',
			'description' => 'Lists the industries Personalisation Hub has pages for, such as fuel and convenience, telco, pharmacy, retail media, grocery and banking, with a one-line summary and URL each. Use it to find the slug that get_industry needs.',
			'inputSchema' => $none,
			'annotations' => $ro,
		),
		array(
			'name'        => 'get_industry',
			'title'       => 'Read an industry page',
			'description' => 'Returns one industry page as markdown: the outcomes it delivers, the touchpoints it covers, worked examples, the business model calculator and the interactive product tour where that industry has them, and its FAQ. Use list_industries for the slugs.',
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
			'title'       => 'Read a product feature page',
			'description' => 'Returns one product page as markdown with its questions and answers: digital signage, queue management, appointment booking, the white label retail media platform, store sites, personalisation, localisation and geo-targeting, or AI agents. The old slug retail-media-platform still works as an alias for white-label-retail-media-platform.',
			'inputSchema' => array(
				'type'                 => 'object',
				'properties'           => array( 'slug' => array( 'type' => 'string', 'enum' => array_merge( array_values( feature_slugs() ), array_keys( feature_slug_aliases() ) ), 'description' => 'Feature page slug (retail-media-platform is an alias for white-label-retail-media-platform)' ) ),
				'required'             => array( 'slug' ),
				'additionalProperties' => false,
			),
			'annotations' => $ro,
		),
		array(
			'name'        => 'search_help',
			'title'       => 'Search the Support Centre',
			'description' => 'Searches the Personalisation Hub Support Centre (set-up guides, how-tos and reference). Plain questions work. Returns matching articles with their URLs, categories and summaries; read one with get_help_article.',
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
			'title'       => 'Read a Support Centre article',
			'description' => 'Returns one Personalisation Hub Support Centre article as markdown. Pass the article URL from search_help. Use it after a search to answer a how-to or set-up question step by step.',
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
			'title'       => 'Start a free trial',
			'description' => 'Returns the link to start the 30-day free trial of Personalisation Hub on AWS Marketplace. Use it when someone wants to try the platform or asks how to get started.',
			'inputSchema' => $none,
			'annotations' => $ro,
		),
		array(
			'name'        => 'book_demo',
			'title'       => 'Book a demo',
			'description' => 'Returns the link to book a Personalisation Hub demo with the team. Use it when someone wants to see the platform first or talk to a person before trying it.',
			'inputSchema' => $none,
			'annotations' => $ro,
		),
		array(
			'name'        => 'get_installation_spec',
			'title'       => 'Get the installation spec',
			'description' => 'Returns everything needed to provision Personalisation Hub in a retailer\'s own AWS account and start the free trial: the AWS Marketplace listing, product ID and subscribe link, pricing, prerequisites, CloudFormation launch steps and parameters, deployment expectations, verification, recovery and teardown. Items not yet public are marked unconfirmed, never guessed. Subscribing, the EULA and the IAM acknowledgement need a human.',
			'inputSchema' => $none,
			'annotations' => $ro,
		),
	);
	$calc = calc_tool_def();
	if ( $calc ) {
		$defs[] = $calc;
	}
	return $defs;
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
					. 'Personalisation Hub is AI-native digital signage and in-store personalisation software for businesses with physical locations, with a white-label retail media platform, queue management, appointment booking and mobile store sites. It is self-hosted in the customer\'s own AWS account, so customer data stays under their control.' . "\n\n## Product areas\n\n";
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
				$slug = feature_slug_aliases()[ $args['slug'] ] ?? $args['slug'];
				$id   = array_search( $slug, feature_slugs(), true );
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

			case 'get_installation_spec':
				$spec = installation_spec();
				$spec['marketplace']['trackedTrialUrl'] = tracked_url( 'free-trial' );
				return tool_text( installation_spec_md( $spec ), $spec );

			case 'calculate_business_model':
				$cals = calc_registry();
				if ( isset( $args['inputs'] ) && ( ! is_array( $args['inputs'] ) || ( $args['inputs'] && array_keys( $args['inputs'] ) === range( 0, count( $args['inputs'] ) - 1 ) ) ) ) {
					return tool_error( 'inputs must be a JSON object of figures by input id.' );
				}
				if ( ! isset( $args['industry'] ) ) {
					if ( ! empty( $args['inputs'] ) ) {
						return tool_error( 'Give an industry with the inputs. Call with no arguments to list them.' );
					}
					$rows = array();
					foreach ( $cals as $slug => $e ) {
						$rows[] = calc_call( 'calc_describe', $slug, $e );
					}
					return tool_text( calc_call( 'calc_catalogue_md', $rows ), array( 'calculators' => $rows ) );
				}
				$e = $cals[ $args['industry'] ] ?? null;
				if ( ! $e ) {
					return tool_error( 'No calculator for that industry yet. Use one of: ' . implode( ', ', array_keys( $cals ) ) . '.' );
				}
				$ids = array_column( calc_call( 'calc_inputs', $e ), 'id' );
				foreach ( (array) ( $args['inputs'] ?? array() ) as $k => $v ) {
					if ( ! in_array( (string) $k, $ids, true ) ) {
						return tool_error( 'Unknown input "' . mb_substr( preg_replace( '/[^\w .\/-]/u', '', (string) $k ), 0, 40 ) . '" for ' . $e['name'] . '. Use: ' . implode( ', ', $ids ) . '.' );
					}
					if ( ! is_int( $v ) && ! is_float( $v ) ) {
						return tool_error( 'Input ' . $k . ' must be a number.' );
					}
				}
				$res = calc_call( 'calc_run', $args['industry'], $e, $args['inputs'] ?? array() );
				return tool_text( calc_call( 'calc_md', $res ), $res );

			case 'book_demo':
				return tool_text( 'Book a Personalisation Hub demo: ' . tracked_url( 'demo' ) . ' (redirects to ' . DEMO_URL . ')', array( 'url' => DEMO_URL, 'trackedUrl' => tracked_url( 'demo' ), 'text' => 'Book a demo' ) );
		}
	} catch ( \Throwable $e ) {
		return tool_error( 'That did not work. Try again later.' );
	}
	return tool_error( 'Unknown tool.' );
}

/* ------------------------------------------------------------------ what agents are told about the tools */

/** First sentence of a tool description, for one-line lists. */
function tool_first_sentence( $desc ) {
	$desc = trim( preg_replace( '/\s+/', ' ', (string) $desc ) );
	$s    = preg_match( '/^(.+?[.!?])(\s|$)/', $desc, $m ) ? $m[1] : $desc;
	return mb_strlen( $s ) > 200 ? rtrim( mb_substr( $s, 0, 197 ) ) . '...' : $s;
}

/** The "## For AI agents" section of llms.txt, generated from the tool contract so it lists every tool and cannot drift. */
function agents_llms_md() {
	$defs = tool_defs();
	$md   = "\n## For AI agents\n\n"
		. '- [Remote MCP server](' . MCP_URL . '): streamable HTTP, no sign-in, ' . count( $defs ) . " read-only tools:\n";
	foreach ( $defs as $d ) {
		$md .= '  - `' . $d['name'] . '`: ' . tool_first_sentence( $d['description'] ) . "\n";
	}
	$md .= '- WebMCP: the same ' . count( $defs ) . ' tools are offered to browser agents through navigator.modelContext on the site\'s pages when the browser supports it, and each business model calculator page adds `run_business_model_calculator`, which fills in the figures on that page' . "\n"
		. '- REST tools: `GET ' . PH_AE_SITE . '/wp-json/ph-agent/v1/tools` lists the tools with their input schemas; `GET ' . PH_AE_SITE . '/wp-json/ph-agent/v1/tools/<name>?args={json}` runs one' . "\n"
		. '- [Help API](' . HELP_API_URL . "): search and fetch Support Centre articles over HTTP\n"
		. '- Markdown twins: every page listed here has a markdown version at the same address with ?format=md' . "\n"
		. '- [Full text](' . PH_AE_SITE . "/llms-full.txt): this file followed by the markdown of every page, in one request\n"
		. '- [Server card](' . PH_AE_SITE . "/.well-known/mcp.json): the MCP server, its endpoint and its tools as JSON\n";
	return $md;
}

/** /.well-known/mcp.json: the remote MCP server's card. The tools are the contract above, unchanged. */
function server_card() {
	return array(
		'name'           => 'Personalisation Hub',
		'title'          => 'Personalisation Hub',
		'description'    => 'Read-only tools for AI agents and AI search about Personalisation Hub, AI-native digital signage and in-store personalisation software with a white-label retail media platform, queue management, appointment booking and store sites, self-hosted in the customer\'s own AWS account: the platform and its industries, product pages, Support Centre articles, a business model calculator, the installation spec, and links to start a free trial or book a demo.',
		'endpoint'       => MCP_URL,
		'transport'      => array( 'type' => 'streamable-http', 'url' => MCP_URL ),
		'remotes'        => array( array( 'type' => 'streamable-http', 'url' => MCP_URL ) ),
		'authentication' => array( 'required' => false ),
		'tools'          => tool_defs(),
		'links'          => array(
			'llms'          => PH_AE_SITE . '/llms.txt',
			'llmsFull'      => PH_AE_SITE . '/llms-full.txt',
			'documentation' => PH_AE_SITE . '/support-centre/',
			'aiAgents'      => PH_AE_SITE . '/ai-agents/',
			'toolsRest'     => PH_AE_SITE . '/wp-json/ph-agent/v1/tools',
			'helpApi'       => HELP_API_URL,
		),
	);
}
