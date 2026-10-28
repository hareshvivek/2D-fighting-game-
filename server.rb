# Local lightweight development server for 2D Showdown
require 'socket'

PORT = 4184
server = TCPServer.new(PORT)
puts "=================================================="
puts "  2D Showdown Local Server"
puts "  Open in browser: http://localhost:#{PORT}"
puts "  Press Ctrl+C to stop"
puts "=================================================="

loop do
  Thread.start(server.accept) do |client|
    begin
      request_line = client.gets
      if request_line
        path = request_line.split(" ")[1] || "/"
        path = "/index.html" if path == "/"
        clean_path = path.split("?").first.sub(/^\//, "")
        file_path = File.expand_path(clean_path, Dir.pwd)

        # Basic security check to ensure file is inside the workspace
        if file_path.start_with?(Dir.pwd) && File.file?(file_path)
          content = File.binread(file_path)
          content_type = case File.extname(file_path).downcase
            when ".html" then "text/html; charset=utf-8"
            when ".css"  then "text/css"
            when ".js"   then "application/javascript"
            when ".png"  then "image/png"
            when ".jpg", ".jpeg" then "image/jpeg"
            when ".svg"  then "image/svg+xml"
            else "text/plain"
          end
          client.print "HTTP/1.1 200 OK\r\nContent-Type: #{content_type}\r\nContent-Length: #{content.bytesize}\r\nConnection: close\r\n\r\n"
          client.write content
        else
          client.print "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        end
      end
    ensure
      client.close
    end
  end
end
