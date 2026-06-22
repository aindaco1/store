module Jekyll
  module MoneyFilter
    def money(input)
      return "$0" if input.nil? || input == ""
      
      # Convert to integer to remove cents
      amount = input.to_i
      
      # Add commas for thousands separators
      amount.to_s.reverse.gsub(/(\d{3})(?=\d)/, '\\1,').reverse.prepend("$")
    end
    
    def money_short(input)
      return "$0" if input.nil? || input == ""
      
      amount = input.to_f
      
      if amount >= 1_000_000
        # Millions
        val = amount / 1_000_000.0
        formatted = val == val.to_i ? val.to_i.to_s : sprintf("%.1f", val).sub(/\.0$/, '')
        "$#{formatted}M"
      elsif amount >= 1_000
        # Thousands
        val = amount / 1_000.0
        formatted = val == val.to_i ? val.to_i.to_s : sprintf("%.1f", val).sub(/\.0$/, '')
        "$#{formatted}K"
      else
        "$#{amount.to_i}"
      end
    end
  end
end

Liquid::Template.register_filter(Jekyll::MoneyFilter)
