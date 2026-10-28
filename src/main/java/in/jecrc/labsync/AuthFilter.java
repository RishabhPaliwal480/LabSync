package in.jecrc.labsync;

import javax.servlet.*;
import javax.servlet.annotation.WebFilter;
import javax.servlet.http.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Session-aware guard for protected API endpoints. */
@WebFilter(urlPatterns = "/api/*")
public class AuthFilter implements Filter {
    @Override public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) throws IOException, ServletException {
        HttpServletRequest req = (HttpServletRequest) request;
        HttpServletResponse res = (HttpServletResponse) response;
        String path = req.getPathInfo() == null ? "/" : req.getPathInfo();
        boolean publicRoute = path.equals("/status") || path.startsWith("/auth/") || (path.equals("/resources") && "GET".equalsIgnoreCase(req.getMethod()));
        if (publicRoute) { chain.doFilter(request, response); return; }
        HttpSession session = req.getSession(false);
        if (session == null || session.getAttribute("userId") == null) {
            res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            res.setContentType("application/json;charset=UTF-8");
            res.setCharacterEncoding(StandardCharsets.UTF_8.name());
            res.getWriter().write("{\"error\":\"Please sign in to continue.\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
