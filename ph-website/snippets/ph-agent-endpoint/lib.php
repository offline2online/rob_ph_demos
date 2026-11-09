<?php
/**
 * PH Agent Endpoint: pure helpers (no WordPress calls), so tests run offline.
 * Allow-list, shared entity nodes, HTML to markdown, llms.txt sections.
 */
namespace AngieSnippets\PhAgentEndpoint___ID__;

if ( ! defined( 'PH_AE_SITE' ) ) {
	define( 'PH_AE_SITE', 'https://personalisationhub.com' );
}
const FREE_TRIAL_URL = 'https://aws.amazon.com/marketplace/pp/prodview-3uiwcnbrpvj76';
const ENTITY_DESCRIPTION = "Self-hosted, self-optimising omnichannel personalisation and retail media platform for physical retail, deployed in the retailer's own cloud.";
const DEMO_URL       = 'https://calendly.com/rob-offline2online';
const MCP_URL        = 'https://backlog-tracker-e4ed2.web.app/help-api/mcp';
const HELP_API_URL   = 'https://backlog-tracker-e4ed2.web.app/help-api/';

/**
 * The page allow-list: page id => [path, kind]. The ONLY pages this snippet
 * gives a twin, JSON-LD or an llms.txt line. Never "every page": demo and
 * campaign pages name clients and brands. Industries, the blog and the
 * Support Centre are owned by their own snippets and are not listed here.
 */
function allow_list() {
	return array(
		2389 => array( '/', 'home' ),
		7020 => array( '/digital-signage/', 'feature' ),
		2711 => array( '/retail-queue-management/', 'feature' ),
		3035 => array( '/retail-appointment-bookings/', 'feature' ),
		3266 => array( '/white-label-retail-media-platform/', 'feature' ),
		3477 => array( '/store-sites/', 'feature' ),
		3566 => array( '/personalisation/', 'feature' ),
		3973 => array( '/localisation-geo-targeting/', 'feature' ),
		6254 => array( '/ai-agents/', 'feature' ),
		7062 => array( '/privacy-policy/', 'legal' ),
		1350 => array( '/legal/', 'legal' ),
		2085 => array( '/support/', 'legal' ),
	);
}

function ids_of_kind( $kind ) {
	$out = array();
	foreach ( allow_list() as $id => $row ) {
		if ( $row[1] === $kind ) {
			$out[] = $id;
		}
	}
	return $out;
}

/**
 * Whether a post may be exposed. $p is a plain array:
 * id, type, status, password, noindex (bool).
 */
function is_exposable( array $p ) {
	$list = allow_list();
	if ( ! isset( $p['id'] ) || ! isset( $list[ (int) $p['id'] ] ) ) {
		return false;
	}
	if ( ( $p['type'] ?? '' ) !== 'page' || ( $p['status'] ?? '' ) !== 'publish' ) {
		return false;
	}
	if ( ! empty( $p['password'] ) || ! empty( $p['noindex'] ) ) {
		return false;
	}
	return true;
}

function page_url( $id ) {
	$list = allow_list();
	return isset( $list[ $id ] ) ? PH_AE_SITE . $list[ $id ][0] : '';
}

function twin_url( $id ) {
	$u = page_url( $id );
	return $u === '' ? '' : $u . '?format=md';
}

/** Organization node: identical on every page (@id #organization). */
function organization_node() {
	return array(
		'@type'       => 'Organization',
		'@id'         => PH_AE_SITE . '/#organization',
		'name'        => 'Personalisation Hub',
		'legalName'   => 'Personalisation Hub Pty Ltd',
		'url'         => PH_AE_SITE . '/',
		'logo'        => 'https://personalisationhub.com/wp-content/uploads/2022/12/Website-Logo.png',
		'description' => ENTITY_DESCRIPTION,
		'foundingDate' => '2018',
		'founder'     => array( '@type' => 'Person', 'name' => 'Rob Geerdink' ),
		'sameAs'      => array(
			'https://www.linkedin.com/company/personalisation-hub/',
			'https://aws.amazon.com/marketplace/pp/prodview-3uiwcnbrpvj76',
			'https://signage.amazon.com/cms-partners/personalisation-hub',
			'https://twitter.com/Digital_retail',
			'https://aws.amazon.com/marketplace/seller-profile?id=seller-ipgfe4tzltv24'
		),
		'knowsAbout'  => array(
			'AI-native digital signage',
			'In-store personalisation',
			'White-label retail media platform',
			'Queue management',
			'Appointment booking',
			'Mobile store sites',
			'Omnichannel personalisation',
			'Self-hosted retail software on AWS',
		),
		'areaServed'  => 'Worldwide',
	);
}

/** SoftwareApplication node: identical on every page (@id #software). */
function software_node() {
	return array(
		'@type'               => 'SoftwareApplication',
		'@id'                 => PH_AE_SITE . '/#software',
		'name'                => 'Personalisation Hub',
		'url'                 => PH_AE_SITE . '/',
		'description'         => ENTITY_DESCRIPTION,
		'applicationCategory' => 'BusinessApplication',
		'operatingSystem'     => 'Web',
		'applicationSubCategory' => 'Digital signage and in-store personalisation software',
		'featureList'         => array(
			'AI-native digital signage',
			'In-store personalisation',
			'White-label retail media platform',
			'Queue management',
			'Appointment booking',
			'Mobile store sites',
			'Localisation and geo-targeting',
			'AI agents that create campaigns',
			'Self-hosted in your own AWS account',
		),
		'softwareHelp'        => array( '@type' => 'CreativeWork', 'name' => 'Personalisation Hub Support Centre', 'url' => PH_AE_SITE . '/support-centre/' ),
		'audience'            => array( '@type' => 'BusinessAudience', 'audienceType' => 'Businesses with physical stores' ),
		'publisher'           => array( '@id' => PH_AE_SITE . '/#organization' ),
		'offers'              => array(
			'@type'         => 'Offer',
			'name'          => 'Free trial on AWS Marketplace',
			'price'         => '0',
			'priceCurrency' => 'USD',
			'url'           => FREE_TRIAL_URL,
			'availability'  => 'https://schema.org/InStock',
			'description'   => '30-day free trial on AWS Marketplace, then billed through the customer\'s AWS account',
		),
	);
}

/**
 * The graph for one allow-listed page: shared entities plus WebPage and
 * BreadcrumbList. $title/$desc are plain text.
 */
function graph_for( $id, $title, $desc ) {
	$url  = page_url( $id );
	$list = allow_list();
	$home = $list[ $id ][1] === 'home';
	$page = array(
		'@type'       => 'WebPage',
		'@id'         => $url . '#webpage',
		'url'         => $url,
		'name'        => $title,
		'description' => $desc,
		'inLanguage'  => 'en',
		'publisher'   => array( '@id' => PH_AE_SITE . '/#organization' ),
		'about'       => array( '@id' => PH_AE_SITE . '/#software' ),
		'breadcrumb'  => array( '@id' => $url . '#breadcrumb' ),
	);
	$items = array( array( '@type' => 'ListItem', 'position' => 1, 'name' => 'Home', 'item' => PH_AE_SITE . '/' ) );
	if ( ! $home ) {
		$items[] = array( '@type' => 'ListItem', 'position' => 2, 'name' => $title, 'item' => $url );
	}
	return array(
		'@context' => 'https://schema.org',
		'@graph'   => array(
			organization_node(),
			software_node(),
			$page,
			array( '@type' => 'BreadcrumbList', '@id' => $url . '#breadcrumb', 'itemListElement' => $items ),
		),
	);
}

/** JSON for an inline script tag: no raw "</" so content can't end the tag. */
function json_ld( array $graph ) {
	$j = json_encode( $graph, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP );
	return $j === false ? '' : $j;
}

/* ---------------------------------------------------------------- markdown */

/** Elements dropped with everything inside them. */
function dropped_tags() {
	return array( 'script', 'style', 'noscript', 'form', 'nav', 'header', 'footer', 'svg', 'iframe', 'button', 'input', 'select', 'textarea', 'template', 'aside', 'canvas', 'object', 'embed' );
}

function md_inline( \DOMNode $n ) {
	$out = '';
	foreach ( $n->childNodes as $c ) {
		if ( $c instanceof \DOMText ) {
			$out .= preg_replace( '/\s+/u', ' ', $c->nodeValue );
		} elseif ( $c instanceof \DOMElement ) {
			$t = strtolower( $c->nodeName );
			if ( in_array( $t, dropped_tags(), true ) ) {
				continue;
			}
			$inner = md_inline( $c );
			if ( $t === 'br' ) {
				$out .= "\n";
			} elseif ( $t === 'a' ) {
				$href = trim( $c->getAttribute( 'href' ) );
				$txt  = trim( $inner );
				if ( $txt === '' ) {
					continue;
				}
				$out .= ( $href === '' || preg_match( '/^(javascript|data):/i', $href ) || $href[0] === '#' ) ? $txt : '[' . $txt . '](' . $href . ')';
			} elseif ( $t === 'strong' || $t === 'b' ) {
				$out .= trim( $inner ) === '' ? '' : '**' . trim( $inner ) . '**';
			} elseif ( $t === 'em' || $t === 'i' ) {
				$out .= trim( $inner ) === '' ? '' : '*' . trim( $inner ) . '*';
			} elseif ( in_array( $t, array( 'ul', 'ol', 'p', 'div', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ), true ) ) {
				$out .= ' ' . $inner . ' ';
			} else {
				$out .= $inner;
			}
		}
	}
	return $out;
}

function md_clean( $s ) {
	$s = preg_replace( '/[ \t\x{00A0}]+/u', ' ', $s );
	$s = preg_replace( '/ *\n */', "\n", $s );
	return trim( $s );
}

function md_block( \DOMNode $n, array &$lines, $depth = 0 ) {
	foreach ( $n->childNodes as $c ) {
		if ( ! $c instanceof \DOMElement ) {
			if ( $c instanceof \DOMText && trim( $c->nodeValue ) !== '' ) {
				$lines[] = md_clean( preg_replace( '/\s+/u', ' ', $c->nodeValue ) );
				$lines[] = '';
			}
			continue;
		}
		$t = strtolower( $c->nodeName );
		if ( in_array( $t, dropped_tags(), true ) ) {
			continue;
		}
		if ( preg_match( '/^h([1-6])$/', $t, $m ) ) {
			$txt = md_clean( md_inline( $c ) );
			if ( $txt !== '' ) {
				$lines[] = str_repeat( '#', (int) $m[1] ) . ' ' . str_replace( "\n", ' ', $txt );
				$lines[] = '';
			}
		} elseif ( $t === 'p' ) {
			$txt = md_clean( md_inline( $c ) );
			if ( $txt !== '' ) {
				$lines[] = $txt;
				$lines[] = '';
			}
		} elseif ( $t === 'ul' || $t === 'ol' ) {
			$i = 0;
			foreach ( $c->childNodes as $li ) {
				if ( $li instanceof \DOMElement && strtolower( $li->nodeName ) === 'li' ) {
					$txt = md_clean( str_replace( "\n", ' ', md_inline( $li ) ) );
					if ( $txt !== '' ) {
						$i++;
						$lines[] = str_repeat( '  ', $depth ) . ( $t === 'ol' ? $i . '. ' : '- ' ) . $txt;
					}
				}
			}
			$lines[] = '';
		} elseif ( $t === 'blockquote' ) {
			$txt = md_clean( md_inline( $c ) );
			if ( $txt !== '' ) {
				$lines[] = '> ' . str_replace( "\n", ' ', $txt );
				$lines[] = '';
			}
		} elseif ( $t === 'a' || $t === 'span' || $t === 'strong' || $t === 'em' || $t === 'b' || $t === 'i' ) {
			$txt = md_clean( md_inline( $c ) );
			if ( $txt !== '' ) {
				$lines[] = $txt;
				$lines[] = '';
			}
		} else {
			md_block( $c, $lines, $depth );
		}
	}
}

/** Rendered HTML to markdown body (headings, paragraphs, lists, links). */
function html_to_markdown( $html ) {
	if ( trim( (string) $html ) === '' ) {
		return '';
	}
	$prev = libxml_use_internal_errors( true );
	$doc  = new \DOMDocument();
	$doc->loadHTML( '<?xml encoding="utf-8"?><body>' . $html . '</body>', LIBXML_NONET | LIBXML_NOWARNING | LIBXML_NOERROR );
	libxml_clear_errors();
	libxml_use_internal_errors( $prev );
	$body  = $doc->getElementsByTagName( 'body' )->item( 0 );
	$lines = array();
	if ( $body ) {
		md_block( $body, $lines );
	}
	$text = implode( "\n", $lines );
	$text = preg_replace( "/\n{3,}/", "\n\n", $text );
	return trim( $text ) . "\n";
}

function markdown_twin( $title, $summary, $canonical, $body_html ) {
	$md = '# ' . trim( $title ) . "\n\n";
	if ( trim( $summary ) !== '' ) {
		$md .= '> ' . trim( preg_replace( '/\s+/', ' ', $summary ) ) . "\n\n";
	}
	$md .= 'Source: ' . $canonical . "\n\n";
	$body = html_to_markdown( $body_html );
	// The page's own H1 duplicates the title line.
	$body = preg_replace( '/^# [^\n]*\n+/', '', $body, 1 );
	return $md . $body;
}

/* --------------------------------------------------------------- llms.txt */

function has_section( $text, $heading ) {
	return (bool) preg_match( '/^## ' . preg_quote( $heading, '/' ) . '\s*$/mi', $text );
}

/**
 * Add ?format=md to the allow-listed feature page links already in the text
 * (existing "## Platform" lines point at the HTML pages).
 */
function twin_links( $text ) {
	foreach ( ids_of_kind( 'feature' ) as $id ) {
		$u    = page_url( $id );
		$text = preg_replace( '~(?<![\w/.-])' . preg_quote( $u, '~' ) . '(?![\w?#/.-])~', twin_url( $id ), $text );
		$text = preg_replace( '~\]\(' . preg_quote( parse_url( $u, PHP_URL_PATH ), '~' ) . '\)~', '](' . twin_url( $id ) . ')', $text );
	}
	return $text;
}

/**
 * $pages: id => [title, summary] for the allow-listed pages that are
 * exposable right now (the caller has already dropped everything else).
 */
function llms_sections( $text, array $pages ) {
	$text = twin_links( $text );
	$add  = '';
	$line = function ( $id ) use ( $pages ) {
		$s = trim( $pages[ $id ][1] ) !== '' ? ': ' . trim( preg_replace( '/\s+/', ' ', $pages[ $id ][1] ) ) : '';
		return '- [' . $pages[ $id ][0] . '](' . twin_url( $id ) . ')' . $s . "\n";
	};
	if ( ! has_section( $text, 'Platform' ) ) {
		$body = '';
		if ( isset( $pages[2389] ) ) {
			$body .= $line( 2389 );
		}
		foreach ( ids_of_kind( 'feature' ) as $id ) {
			if ( isset( $pages[ $id ] ) ) {
				$body .= $line( $id );
			}
		}
		if ( $body !== '' ) {
			$add .= "\n## Platform\n\n" . $body;
		}
	}
	if ( ! has_section( $text, 'Company' ) ) {
		$body = '';
		foreach ( ids_of_kind( 'legal' ) as $id ) {
			if ( isset( $pages[ $id ] ) ) {
				$body .= $line( $id );
			}
		}
		if ( $body !== '' ) {
			$add .= "\n## Company\n\n" . $body;
		}
	}
	if ( ! has_section( $text, 'For AI agents' ) ) {
		require_once __DIR__ . '/tools.php';
		$add .= agents_llms_md();
	}
	return rtrim( $text ) . "\n" . $add;
}

/**
 * /llms-full.txt: llms.txt followed by the full markdown twin of each page, each under its URL.
 * $docs: list of [url, markdown]; entries with no markdown are skipped.
 */
function llms_full_text( $llms, array $docs ) {
	$out = rtrim( (string) $llms ) . "\n";
	foreach ( $docs as $d ) {
		if ( ! is_array( $d ) || ! isset( $d[1] ) || trim( (string) $d[1] ) === '' ) {
			continue;
		}
		$out .= "\n---\n\nURL: " . $d[0] . "\n\n" . trim( (string) $d[1] ) . "\n";
	}
	return $out;
}
