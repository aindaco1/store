# frozen_string_literal: true

module Jekyll
  module ImageDimensionsFilter
    DIMENSION_CACHE = {}

    def local_image_dimensions(src)
      site = @context.registers[:site]
      source = site&.source
      src_path = src.to_s.split('?').first
      return {} if source.nil? || src_path.empty? || !src_path.start_with?('/')

      absolute_source = File.expand_path(source)
      image_path = File.expand_path(src_path.sub(%r{\A/+}, ''), absolute_source)
      return {} unless image_path.start_with?(absolute_source + File::SEPARATOR)
      return {} unless File.file?(image_path)

      DIMENSION_CACHE[image_path] ||= read_image_dimensions(image_path)
    end

    private

    def read_image_dimensions(image_path)
      data = File.binread(image_path, 64 * 1024)
      dimensions =
        png_dimensions(data) ||
        gif_dimensions(data) ||
        jpeg_dimensions(data) ||
        webp_dimensions(data)
      dimensions || {}
    rescue StandardError
      {}
    end

    def png_dimensions(data)
      return unless data.bytesize >= 24 && data.start_with?("\x89PNG\r\n\x1A\n".b)

      width, height = data.byteslice(16, 8).unpack('NN')
      { 'width' => width, 'height' => height }
    end

    def gif_dimensions(data)
      return unless data.bytesize >= 10 && (data.start_with?('GIF87a') || data.start_with?('GIF89a'))

      width, height = data.byteslice(6, 4).unpack('vv')
      { 'width' => width, 'height' => height }
    end

    def jpeg_dimensions(data)
      return unless data.bytesize >= 4 && data.getbyte(0) == 0xFF && data.getbyte(1) == 0xD8

      index = 2
      while index + 4 < data.bytesize
        index += 1 while index < data.bytesize && data.getbyte(index) == 0xFF
        marker = data.getbyte(index)
        index += 1
        next if marker.nil? || marker == 0xD8 || marker == 0xD9

        segment_length = data.byteslice(index, 2)&.unpack1('n')
        return if segment_length.nil? || segment_length < 2

        if jpeg_size_marker?(marker)
          segment = data.byteslice(index + 2, segment_length - 2)
          return if segment.nil? || segment.bytesize < 5

          height, width = segment.byteslice(1, 4).unpack('nn')
          return { 'width' => width, 'height' => height }
        end

        index += segment_length
      end
    end

    def jpeg_size_marker?(marker)
      [
        0xC0, 0xC1, 0xC2, 0xC3,
        0xC5, 0xC6, 0xC7,
        0xC9, 0xCA, 0xCB,
        0xCD, 0xCE, 0xCF
      ].include?(marker)
    end

    def webp_dimensions(data)
      return unless data.bytesize >= 30 && data.start_with?('RIFF') && data.byteslice(8, 4) == 'WEBP'

      chunk_type = data.byteslice(12, 4)
      case chunk_type
      when 'VP8X'
        return unless data.bytesize >= 30

        width = 1 + little_endian_24(data.byteslice(24, 3))
        height = 1 + little_endian_24(data.byteslice(27, 3))
        { 'width' => width, 'height' => height }
      when 'VP8L'
        return unless data.bytesize >= 25 && data.getbyte(20) == 0x2F

        b0 = data.getbyte(21)
        b1 = data.getbyte(22)
        b2 = data.getbyte(23)
        b3 = data.getbyte(24)
        width = 1 + (((b1 & 0x3F) << 8) | b0)
        height = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6))
        { 'width' => width, 'height' => height }
      when 'VP8 '
        return unless data.bytesize >= 30

        width = data.byteslice(26, 2).unpack1('v') & 0x3FFF
        height = data.byteslice(28, 2).unpack1('v') & 0x3FFF
        { 'width' => width, 'height' => height }
      end
    end

    def little_endian_24(bytes)
      return 0 if bytes.nil? || bytes.bytesize < 3

      bytes.getbyte(0) | (bytes.getbyte(1) << 8) | (bytes.getbyte(2) << 16)
    end
  end
end

Liquid::Template.register_filter(Jekyll::ImageDimensionsFilter)
