package in.jecrc.labsync;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.time.*;
import java.time.format.DateTimeParseException;
import java.util.*;

/** MVC controller/API layer. Views are served by index.jsp; data operations use JDBC. */
@WebServlet(urlPatterns = "/api/*", loadOnStartup = 1)
public class ApiServlet extends HttpServlet {
    private static final long serialVersionUID = 1L;
    private static final Gson GSON = new Gson();

    @Override public void init() throws ServletException {
        try { Database.initialize(); }
        catch (RuntimeException e) { throw new ServletException(e); }
    }

    @Override protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException { route(req, resp); }
    @Override protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException { route(req, resp); }
    @Override protected void doPut(HttpServletRequest req, HttpServletResponse resp) throws IOException { route(req, resp); }
    @Override protected void doDelete(HttpServletRequest req, HttpServletResponse resp) throws IOException { route(req, resp); }

    private void route(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        resp.setCharacterEncoding(StandardCharsets.UTF_8.name());
        resp.setContentType("application/json;charset=UTF-8");
        String path = req.getPathInfo() == null ? "/" : req.getPathInfo();
        String method = req.getMethod().toUpperCase(Locale.ROOT);
        try {
            if ("GET".equals(method) && "/status".equals(path)) { send(resp, 200, map("ok", true, "app", "LabSync", "mode", "jdbc")); return; }
            if (path.startsWith("/auth/")) { auth(req, resp, path, method); return; }
            if ("/resources".equals(path) && "GET".equals(method)) { send(resp, 200, resources()); return; }
            if ("/resources".equals(path) && "POST".equals(method)) { requireAdmin(req); createResource(req, resp); return; }
            if (path.matches("/resources/\\d+/status") && "POST".equals(method)) { requireAdmin(req); updateResourceStatus(req, resp, path); return; }
            if ("/bookings".equals(path) && "GET".equals(method)) { send(resp, 200, bookings(req)); return; }
            if ("/bookings".equals(path) && "POST".equals(method)) { createBooking(req, resp); return; }
            if (path.matches("/bookings/\\d+/cancel") && "POST".equals(method)) { cancelBooking(req, resp, path); return; }
            if ("/issues".equals(path) && "GET".equals(method)) { send(resp, 200, issues(req)); return; }
            if ("/issues".equals(path) && "POST".equals(method)) { createIssue(req, resp); return; }
            if (path.matches("/issues/\\d+/status") && "POST".equals(method)) { requireAdmin(req); updateIssueStatus(req, resp, path); return; }
            if ("/admin/summary".equals(path) && "GET".equals(method)) { requireAdmin(req); send(resp, 200, adminSummary()); return; }
            send(resp, 404, map("error", "Endpoint not found."));
        } catch (ApiException e) {
            send(resp, e.status, map("error", e.getMessage()));
        } catch (DateTimeParseException | IllegalArgumentException e) {
            send(resp, 400, map("error", "Please check the submitted values and try again."));
        } catch (SQLException e) {
            e.printStackTrace();
            send(resp, 500, map("error", "A database operation failed. Check the server log for details."));
        } catch (Exception e) {
            e.printStackTrace();
            send(resp, 500, map("error", "The request could not be completed."));
        }
    }

    private void auth(HttpServletRequest req, HttpServletResponse resp, String path, String method) throws Exception {
        if ("/auth/me".equals(path) && "GET".equals(method)) {
            HttpSession s = req.getSession(false);
            if (s == null || s.getAttribute("userId") == null) { send(resp, 200, map("authenticated", false)); return; }
            send(resp, 200, sessionUser(s)); return;
        }
        if ("/auth/login".equals(path) && "POST".equals(method)) {
            JsonObject body = body(req);
            String email = required(body, "email").toLowerCase(Locale.ROOT);
            String password = required(body, "password");
            try (Connection c = Database.getConnection(); PreparedStatement p = c.prepareStatement("SELECT id,name,email,password_hash,role FROM users WHERE LOWER(email)=?")) {
                p.setString(1, email);
                try (ResultSet rs = p.executeQuery()) {
                    if (!rs.next() || !PasswordUtil.verify(password, rs.getString("password_hash"))) throw new ApiException(401, "Email or password is incorrect.");
                    HttpSession s = req.getSession(true);
                    s.setAttribute("userId", rs.getLong("id")); s.setAttribute("userName", rs.getString("name"));
                    s.setAttribute("userEmail", rs.getString("email")); s.setAttribute("userRole", rs.getString("role"));
                    s.setMaxInactiveInterval(30 * 60);
                    send(resp, 200, sessionUser(s));
                }
            }
            return;
        }
        if ("/auth/logout".equals(path) && "POST".equals(method)) {
            HttpSession s = req.getSession(false); if (s != null) s.invalidate();
            send(resp, 200, map("ok", true)); return;
        }
        send(resp, 404, map("error", "Authentication endpoint not found."));
    }

    private List<Map<String,Object>> resources() throws SQLException {
        List<Map<String,Object>> list = new ArrayList<>();
        String sql = "SELECT id,name,category,lab_name,location,description,status,active FROM resources WHERE active=TRUE ORDER BY CASE status WHEN 'AVAILABLE' THEN 0 WHEN 'MAINTENANCE' THEN 1 ELSE 2 END, name";
        try (Connection c = Database.getConnection(); PreparedStatement p = c.prepareStatement(sql); ResultSet rs = p.executeQuery()) {
            while (rs.next()) list.add(map("id",rs.getLong("id"),"name",rs.getString("name"),"category",rs.getString("category"),"lab",rs.getString("lab_name"),"location",rs.getString("location"),"description",rs.getString("description"),"status",rs.getString("status"),"active",rs.getBoolean("active")));
        }
        return list;
    }

    private void createResource(HttpServletRequest req, HttpServletResponse resp) throws Exception {
        JsonObject b = body(req);
        String name = required(b,"name"), category = required(b,"category"), lab = required(b,"lab"), location = required(b,"location");
        String description = optional(b,"description");
        try (Connection c = Database.getConnection(); PreparedStatement p = c.prepareStatement("INSERT INTO resources(name,category,lab_name,location,description,status) VALUES(?,?,?,?,?,'AVAILABLE')", Statement.RETURN_GENERATED_KEYS)) {
            p.setString(1,name); p.setString(2,category); p.setString(3,lab); p.setString(4,location); p.setString(5,description); p.executeUpdate();
            try (ResultSet keys = p.getGeneratedKeys()) { keys.next(); send(resp,201,map("id",keys.getLong(1),"name",name,"category",category,"lab",lab,"location",location,"description",description,"status","AVAILABLE")); }
        }
    }

    private void updateResourceStatus(HttpServletRequest req, HttpServletResponse resp, String path) throws Exception {
        long id = idFrom(path, 2); JsonObject b = body(req); String status = required(b,"status").toUpperCase(Locale.ROOT);
        if (!Arrays.asList("AVAILABLE","MAINTENANCE","UNAVAILABLE").contains(status)) throw new ApiException(400,"Invalid resource status.");
        try (Connection c = Database.getConnection()) {
            if ("AVAILABLE".equals(status)) {
                try (PreparedStatement check = c.prepareStatement("SELECT COUNT(*) FROM issues WHERE resource_id=? AND status<>'RESOLVED'")) {
                    check.setLong(1,id); try (ResultSet rs = check.executeQuery()) { rs.next(); if (rs.getInt(1)>0) throw new ApiException(409,"Resolve the open issue before making this resource available."); }
                }
            }
            try (PreparedStatement p = c.prepareStatement("UPDATE resources SET status=? WHERE id=? AND active=TRUE")) {
                p.setString(1,status); p.setLong(2,id); if (p.executeUpdate()==0) throw new ApiException(404,"Resource not found.");
            }
        }
        send(resp,200,map("ok",true,"id",id,"status",status));
    }

    private List<Map<String,Object>> bookings(HttpServletRequest req) throws SQLException {
        List<Map<String,Object>> list = new ArrayList<>(); boolean admin = isAdmin(req);
        String sql = "SELECT b.id,b.user_id,b.resource_id,b.booking_date,b.start_time,b.end_time,b.purpose,b.status,b.created_at,r.name AS resource_name,r.category,r.lab_name,u.name AS user_name FROM bookings b JOIN resources r ON r.id=b.resource_id JOIN users u ON u.id=b.user_id " + (admin ? "" : "WHERE b.user_id=? ") + "ORDER BY b.booking_date DESC,b.start_time DESC";
        try (Connection c = Database.getConnection(); PreparedStatement p = c.prepareStatement(sql)) {
            if (!admin) p.setLong(1,userId(req));
            try (ResultSet rs = p.executeQuery()) { while (rs.next()) list.add(map("id",rs.getLong("id"),"userId",rs.getLong("user_id"),"resourceId",rs.getLong("resource_id"),"date",rs.getDate("booking_date").toString(),"startTime",rs.getTime("start_time").toString().substring(0,5),"endTime",rs.getTime("end_time").toString().substring(0,5),"purpose",rs.getString("purpose"),"status",rs.getString("status"),"resourceName",rs.getString("resource_name"),"category",rs.getString("category"),"lab",rs.getString("lab_name"),"userName",rs.getString("user_name"))); }
        }
        return list;
    }

    private void createBooking(HttpServletRequest req, HttpServletResponse resp) throws Exception {
        JsonObject b = body(req); long resourceId = longValue(b,"resourceId"); String dateText=required(b,"date"), startText=required(b,"startTime"), endText=required(b,"endTime"), purpose=required(b,"purpose");
        LocalDate date=LocalDate.parse(dateText); LocalTime start=LocalTime.parse(startText), end=LocalTime.parse(endText);
        if (!end.isAfter(start)) throw new ApiException(400,"The end time must be after the start time.");
        if (LocalDateTime.of(date,start).isBefore(LocalDateTime.now())) throw new ApiException(400,"Choose a future date and time.");
        try (Connection c = Database.getConnection()) {
            c.setAutoCommit(false);
            try {
                String status;
                try (PreparedStatement p=c.prepareStatement("SELECT status FROM resources WHERE id=? AND active=TRUE")) { p.setLong(1,resourceId); try(ResultSet rs=p.executeQuery()){ if(!rs.next()) throw new ApiException(404,"Resource not found."); status=rs.getString(1); } }
                if (!"AVAILABLE".equals(status)) throw new ApiException(409,"This resource is not available for booking.");
                try (PreparedStatement p=c.prepareStatement("SELECT COUNT(*) FROM issues WHERE resource_id=? AND status<>'RESOLVED'")) { p.setLong(1,resourceId); try(ResultSet rs=p.executeQuery()){ rs.next(); if(rs.getInt(1)>0) throw new ApiException(409,"This resource has an unresolved maintenance issue."); } }
                try (PreparedStatement p=c.prepareStatement("SELECT COUNT(*) FROM bookings WHERE resource_id=? AND booking_date=? AND status='CONFIRMED' AND start_time < ? AND end_time > ?")) {
                    p.setLong(1,resourceId); p.setDate(2,java.sql.Date.valueOf(date)); p.setTime(3,Time.valueOf(end)); p.setTime(4,Time.valueOf(start));
                    try(ResultSet rs=p.executeQuery()){rs.next(); if(rs.getInt(1)>0) throw new ApiException(409,"That time slot is already booked. Choose another slot.");}
                }
                try (PreparedStatement p=c.prepareStatement("INSERT INTO bookings(user_id,resource_id,booking_date,start_time,end_time,purpose,status) VALUES(?,?,?,?,?,?,'CONFIRMED')",Statement.RETURN_GENERATED_KEYS)) {
                    p.setLong(1,userId(req)); p.setLong(2,resourceId); p.setDate(3,java.sql.Date.valueOf(date)); p.setTime(4,Time.valueOf(start)); p.setTime(5,Time.valueOf(end)); p.setString(6,purpose); p.executeUpdate();
                    try(ResultSet keys=p.getGeneratedKeys()){keys.next(); long id=keys.getLong(1); c.commit(); send(resp,201,map("id",id,"resourceId",resourceId,"date",date.toString(),"startTime",start.toString(),"endTime",end.toString(),"purpose",purpose,"status","CONFIRMED"));}
                }
            } catch(Exception e){ try{c.rollback();}catch(SQLException ignored){} throw e; }
            finally { try{c.setAutoCommit(true);}catch(SQLException ignored){} }
        }
    }

    private void cancelBooking(HttpServletRequest req, HttpServletResponse resp, String path) throws Exception {
        long id=idFrom(path,1); boolean admin=isAdmin(req);
        try(Connection c=Database.getConnection(); PreparedStatement p=c.prepareStatement("UPDATE bookings SET status='CANCELLED' WHERE id=? AND status='CONFIRMED'"+(admin?"":" AND user_id=?"))){
            p.setLong(1,id); if(!admin)p.setLong(2,userId(req)); if(p.executeUpdate()==0) throw new ApiException(404,"Booking not found or already cancelled.");
        }
        send(resp,200,map("ok",true,"id",id,"status","CANCELLED"));
    }

    private List<Map<String,Object>> issues(HttpServletRequest req) throws SQLException {
        List<Map<String,Object>> list=new ArrayList<>(); boolean admin=isAdmin(req);
        String sql="SELECT i.id,i.resource_id,i.reporter_id,i.title,i.description,i.severity,i.status,i.created_at,r.name AS resource_name,r.lab_name,u.name AS reporter_name FROM issues i JOIN resources r ON r.id=i.resource_id JOIN users u ON u.id=i.reporter_id "+(admin?"":"WHERE i.reporter_id=? ")+"ORDER BY CASE i.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,i.created_at DESC";
        try(Connection c=Database.getConnection();PreparedStatement p=c.prepareStatement(sql)){if(!admin)p.setLong(1,userId(req));try(ResultSet rs=p.executeQuery()){while(rs.next())list.add(map("id",rs.getLong("id"),"resourceId",rs.getLong("resource_id"),"reporterId",rs.getLong("reporter_id"),"title",rs.getString("title"),"description",rs.getString("description"),"severity",rs.getString("severity"),"status",rs.getString("status"),"createdAt",rs.getTimestamp("created_at").toString(),"resourceName",rs.getString("resource_name"),"lab",rs.getString("lab_name"),"reporterName",rs.getString("reporter_name")));}}
        return list;
    }

    private void createIssue(HttpServletRequest req, HttpServletResponse resp) throws Exception {
        JsonObject b=body(req);long resourceId=longValue(b,"resourceId");String title=required(b,"title"),description=required(b,"description"),severity=required(b,"severity").toUpperCase(Locale.ROOT);
        if(!Arrays.asList("LOW","MEDIUM","HIGH","CRITICAL").contains(severity))throw new ApiException(400,"Invalid severity.");
        try(Connection c=Database.getConnection()){
            c.setAutoCommit(false);
            try{
                try(PreparedStatement p=c.prepareStatement("SELECT id FROM resources WHERE id=? AND active=TRUE")){p.setLong(1,resourceId);try(ResultSet rs=p.executeQuery()){if(!rs.next())throw new ApiException(404,"Resource not found.");}}
                try(PreparedStatement p=c.prepareStatement("INSERT INTO issues(resource_id,reporter_id,title,description,severity,status) VALUES(?,?,?,?,?,'OPEN')",Statement.RETURN_GENERATED_KEYS)){
                    p.setLong(1,resourceId);p.setLong(2,userId(req));p.setString(3,title);p.setString(4,description);p.setString(5,severity);p.executeUpdate();try(ResultSet k=p.getGeneratedKeys()){k.next();long id=k.getLong(1);}
                }
                try(PreparedStatement p=c.prepareStatement("UPDATE resources SET status='MAINTENANCE' WHERE id=? AND status<>'UNAVAILABLE'")){p.setLong(1,resourceId);p.executeUpdate();}
                c.commit();
            }catch(Exception e){try{c.rollback();}catch(SQLException ignored){}throw e;}finally{try{c.setAutoCommit(true);}catch(SQLException ignored){}}
        }
        send(resp,201,map("ok",true,"status","OPEN","message","Issue reported. The resource has been flagged for maintenance."));
    }

    private void updateIssueStatus(HttpServletRequest req,HttpServletResponse resp,String path)throws Exception{
        long id=idFrom(path,1);JsonObject b=body(req);String status=required(b,"status").toUpperCase(Locale.ROOT);
        if(!Arrays.asList("OPEN","IN_PROGRESS","RESOLVED").contains(status))throw new ApiException(400,"Invalid issue status.");
        long resourceId;
        try(Connection c=Database.getConnection()){
            c.setAutoCommit(false);
            try{
                try(PreparedStatement p=c.prepareStatement("UPDATE issues SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")){p.setString(1,status);p.setLong(2,id);if(p.executeUpdate()==0)throw new ApiException(404,"Issue not found.");}
                try(PreparedStatement p=c.prepareStatement("SELECT resource_id FROM issues WHERE id=?")){p.setLong(1,id);try(ResultSet rs=p.executeQuery()){rs.next();resourceId=rs.getLong(1);}}
                if("RESOLVED".equals(status)){
                    try(PreparedStatement p=c.prepareStatement("SELECT COUNT(*) FROM issues WHERE resource_id=? AND status<>'RESOLVED'")){p.setLong(1,resourceId);try(ResultSet rs=p.executeQuery()){rs.next();if(rs.getInt(1)==0)try(PreparedStatement update=c.prepareStatement("UPDATE resources SET status='AVAILABLE' WHERE id=? AND status='MAINTENANCE'")){update.setLong(1,resourceId);update.executeUpdate();}}}
                }else{try(PreparedStatement p=c.prepareStatement("UPDATE resources SET status='MAINTENANCE' WHERE id=? AND status<>'UNAVAILABLE'")){p.setLong(1,resourceId);p.executeUpdate();}}
                c.commit();
            }catch(Exception e){try{c.rollback();}catch(SQLException ignored){}throw e;}finally{try{c.setAutoCommit(true);}catch(SQLException ignored){}}
        }
        send(resp,200,map("ok",true,"id",id,"status",status));
    }

    private Map<String,Object> adminSummary() throws SQLException {
        try(Connection c=Database.getConnection()){
            return map("resources",count(c,"SELECT COUNT(*) FROM resources WHERE active=TRUE"),"availableResources",count(c,"SELECT COUNT(*) FROM resources WHERE active=TRUE AND status='AVAILABLE'"),"activeBookings",count(c,"SELECT COUNT(*) FROM bookings WHERE status='CONFIRMED' AND booking_date>=CURRENT_DATE"),"openIssues",count(c,"SELECT COUNT(*) FROM issues WHERE status<>'RESOLVED'"),"students",count(c,"SELECT COUNT(*) FROM users WHERE role='STUDENT'"));
        }
    }
    private long count(Connection c,String sql)throws SQLException{try(Statement s=c.createStatement();ResultSet rs=s.executeQuery(sql)){rs.next();return rs.getLong(1);}}

    private static JsonObject body(HttpServletRequest req)throws IOException{
        try(BufferedReader r=new BufferedReader(new InputStreamReader(req.getInputStream(),StandardCharsets.UTF_8))){JsonObject o=JsonParser.parseReader(r).getAsJsonObject();return o==null?new JsonObject():o;}
        catch(RuntimeException e){throw new ApiException(400,"Request body must be valid JSON.");}
    }
    private static String required(JsonObject o,String k){String v=optional(o,k);if(v.isEmpty())throw new ApiException(400,"Missing required field: "+k+".");return v;}
    private static String optional(JsonObject o,String k){return o.has(k)&&!o.get(k).isJsonNull()?o.get(k).getAsString().trim():"";}
    private static long longValue(JsonObject o,String k){try{return Long.parseLong(required(o,k));}catch(NumberFormatException e){throw new ApiException(400,"Invalid numeric field: "+k+".");}}
    private static long idFrom(String path,int index){try{return Long.parseLong(path.split("/")[index]);}catch(Exception e){throw new ApiException(400,"Invalid record ID.");}}
    private static long userId(HttpServletRequest req){return (Long)req.getSession(false).getAttribute("userId");}
    private static boolean isAdmin(HttpServletRequest req){HttpSession s=req.getSession(false);return s!=null&&"ADMIN".equals(s.getAttribute("userRole"));}
    private static void requireAdmin(HttpServletRequest req){if(!isAdmin(req))throw new ApiException(403,"Administrator access is required for this action.");}
    private static Map<String,Object> sessionUser(HttpSession s){return map("authenticated",true,"id",s.getAttribute("userId"),"name",s.getAttribute("userName"),"email",s.getAttribute("userEmail"),"role",s.getAttribute("userRole"));}
    private static Map<String,Object> map(Object...values){Map<String,Object> m=new LinkedHashMap<>();for(int i=0;i+1<values.length;i+=2)m.put(String.valueOf(values[i]),values[i+1]);return m;}
    private static void send(HttpServletResponse resp,int status,Object value)throws IOException{resp.setStatus(status);resp.setContentType("application/json;charset=UTF-8");resp.getWriter().write(GSON.toJson(value));}

    private static final class ApiException extends RuntimeException { private static final long serialVersionUID = 1L; final int status; ApiException(int status,String message){super(message);this.status=status;} }
}
