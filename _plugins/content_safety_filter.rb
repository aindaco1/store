require 'cgi'
require 'kramdown'
require 'uri'

module Jekyll
  module ContentSafetyFilter
    PLACEHOLDERS = {
      /<br\s*\/?>/i => '__STORE_SAFE_BR__',
      /<em>/i => '__STORE_SAFE_EM_OPEN__',
      /<\/em>/i => '__STORE_SAFE_EM_CLOSE__',
      /<strong>/i => '__STORE_SAFE_STRONG_OPEN__',
      /<\/strong>/i => '__STORE_SAFE_STRONG_CLOSE__',
      /<i>/i => '__STORE_SAFE_I_OPEN__',
      /<\/i>/i => '__STORE_SAFE_I_CLOSE__',
      /<b>/i => '__STORE_SAFE_B_OPEN__',
      /<\/b>/i => '__STORE_SAFE_B_CLOSE__',
      /<u>/i => '__STORE_SAFE_U_OPEN__',
      /<\/u>/i => '__STORE_SAFE_U_CLOSE__'
    }.freeze

    RESTORED_TAGS = {
      '__STORE_SAFE_BR__' => '<br>',
      '__STORE_SAFE_EM_OPEN__' => '<em>',
      '__STORE_SAFE_EM_CLOSE__' => '</em>',
      '__STORE_SAFE_STRONG_OPEN__' => '<strong>',
      '__STORE_SAFE_STRONG_CLOSE__' => '</strong>',
      '__STORE_SAFE_I_OPEN__' => '<i>',
      '__STORE_SAFE_I_CLOSE__' => '</i>',
      '__STORE_SAFE_B_OPEN__' => '<b>',
      '__STORE_SAFE_B_CLOSE__' => '</b>',
      '__STORE_SAFE_U_OPEN__' => '<u>',
      '__STORE_SAFE_U_CLOSE__' => '</u>'
    }.freeze

    def safe_rich_text(input)
      sanitize_rich_text(input)
    end

    def safe_markdown_source(input)
      sanitize_rich_text(normalize_markdown_emphasis_spacing(input))
    end

    def safe_markdownify(input, site_url = nil)
      sanitized = safe_markdown_source(input)
      html = Kramdown::Document.new(sanitized).to_html
      sanitize_markdown_links(html, site_url)
    end

    def sanitize_markdown_links(html, site_url = nil)
      sanitize_rendered_markdown_links(html, site_url)
    end

    def approved_embed_src(input, provider)
      src = input.to_s.strip
      return '' if src.empty?

      uri = parse_uri(src)
      return '' unless uri
      return '' unless uri.scheme == 'https'

      case provider.to_s.downcase
      when 'spotify'
        return src if uri.host == 'open.spotify.com' && uri.path.start_with?('/embed/')
      when 'youtube'
        return src if (uri.host == 'www.youtube.com' || uri.host == 'www.youtube-nocookie.com') &&
          uri.path.start_with?('/embed/')
      when 'vimeo'
        return src if uri.host == 'player.vimeo.com' && uri.path.start_with?('/video/')
      end

      ''
    end

    private

    def normalize_markdown_emphasis_spacing(input)
      text = input.to_s.dup
      text.gsub!(/\*\*(\s*)((?:(?!\*\*|\n).)*?\S)(\s*)\*\*/) do
        "#{Regexp.last_match(1)}**#{Regexp.last_match(2)}**#{Regexp.last_match(3)}"
      end
      text.gsub!(/(?<!\*)\*(?!\*)(\s*)([^\n*]*?\S)(\s*)(?<!\*)\*(?!\*)/) do
        "#{Regexp.last_match(1)}*#{Regexp.last_match(2)}*#{Regexp.last_match(3)}"
      end
      text.gsub!(/(?<!_)_(?!_)(\s*)([^\n_]*?\S)(\s*)(?<!_)_(?!_)/) do
        "#{Regexp.last_match(1)}_#{Regexp.last_match(2)}_#{Regexp.last_match(3)}"
      end
      text
    end

    def sanitize_rich_text(input)
      text = input.to_s.dup

      PLACEHOLDERS.each do |pattern, token|
        text.gsub!(pattern, token)
      end

      text = CGI.escapeHTML(text)

      RESTORED_TAGS.each do |token, html|
        text.gsub!(token, html)
      end

      text
    end

    def sanitize_rendered_markdown_links(html, site_url = nil)
      return html unless html&.include?('<a')

      site_host = begin
        site_url && URI.parse(site_url).host
      rescue URI::InvalidURIError
        nil
      end

      html.gsub(/<a\b([^>]*?)href=(['"])([^'"]+)\2([^>]*)>/i) do |match|
        leading_attrs = Regexp.last_match(1)
        href = Regexp.last_match(3)
        trailing_attrs = Regexp.last_match(4)

        updated = match.dup

        unless allowed_link_href?(href)
          updated.sub!(/href=(['"])([^'"]+)\1/i, 'href="#"')
          updated.gsub!(/\s+target=(['"])[^'"]*\1/i, '')
          updated.gsub!(/\s+rel=(['"])[^'"]*\1/i, '')
          next updated
        end

        if external_http_link?(href, site_host)
          unless leading_attrs.match?(/\btarget\s*=/i) || trailing_attrs.match?(/\btarget\s*=/i)
            updated.sub!('<a', '<a target="_blank"')
          end

          unless leading_attrs.match?(/\brel\s*=/i) || trailing_attrs.match?(/\brel\s*=/i)
            updated.sub!('<a', '<a rel="noopener noreferrer"')
          end
        end

        updated
      end
    end

    def allowed_link_href?(href)
      return false if href.nil?

      raw = href.to_s.strip
      return false if raw.empty?

      html_entity_variants(raw).all? do |candidate|
        allowed_normalized_link_href?(candidate)
      end
    end

    def external_http_link?(href, site_host)
      uri = parse_uri(CGI.unescapeHTML(href.to_s))
      return false unless uri
      return false unless %w[http https].include?(uri.scheme.to_s.downcase)
      return true if site_host.nil? || site_host.empty?

      uri.host != site_host
    end

    def allowed_normalized_link_href?(value)
      normalized = value.to_s.gsub(/[\u0000-\u0020]+/, '').strip
      return false if normalized.empty?
      return true if normalized.start_with?('#', '?', './', '../')
      return true if normalized.start_with?('/') && !normalized.start_with?('//')

      uri = parse_uri(normalized)
      return false unless uri
      return true if uri.scheme.nil? && uri.host.nil?

      %w[http https mailto].include?(uri.scheme.to_s.downcase)
    end

    def html_entity_variants(value)
      variants = []
      current = value.to_s

      4.times do
        variants << current
        decoded = CGI.unescapeHTML(current)
        break if decoded == current

        current = decoded
      end

      variants << current
      variants.uniq
    end

    def parse_uri(value)
      normalized = value.to_s.gsub(/[\u0000-\u0020]+/, '')
      URI.parse(normalized)
    rescue URI::InvalidURIError
      nil
    end
  end
end

Liquid::Template.register_filter(Jekyll::ContentSafetyFilter)
