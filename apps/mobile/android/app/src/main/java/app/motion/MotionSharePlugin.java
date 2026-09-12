package app.motion;

import android.content.Intent;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "MotionShare")
public class MotionSharePlugin extends Plugin {
    private static final String STORE = "motion_share_queue";
    private static final String QUEUE = "pending";
    private static final String EVENT_ID = "app.motion.SHARE_EVENT_ID";

    private SharedPreferences preferences() {
        return getActivity().getSharedPreferences(STORE, 0);
    }

    private JSONArray pending() {
        try {
            return new JSONArray(preferences().getString(QUEUE, "[]"));
        } catch (JSONException ignored) {
            return new JSONArray();
        }
    }

    private void save(JSONArray shares) {
        preferences().edit().putString(QUEUE, shares.toString()).commit();
    }

    @Override
    protected synchronized void handleOnNewIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction()) ||
            !"text/plain".equals(intent.getType())) return;

        CharSequence shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String text = shared == null ? intent.getDataString() : shared.toString();
        CharSequence subjectValue = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
        String subject = subjectValue == null ? null : subjectValue.toString();
        if ((text == null || text.trim().isEmpty()) && (subject == null || subject.trim().isEmpty())) return;

        String eventId = intent.getStringExtra(EVENT_ID);
        if (eventId == null) {
            eventId = UUID.randomUUID().toString();
            intent.putExtra(EVENT_ID, eventId);
        }
        JSONArray queue = pending();
        for (int i = 0; i < queue.length(); i++) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && eventId.equals(item.optString("eventId"))) return;
        }
        JSObject payload = new JSObject();
        payload.put("eventId", eventId);
        payload.put("text", text);
        payload.put("subject", subject);
        queue.put(payload);
        save(queue);
        notifyListeners("shareReceived", payload);
        // The queue survives process death; the launch intent should not replay on recreation.
        intent.setAction(Intent.ACTION_MAIN);
    }

    @PluginMethod
    public synchronized void getPendingShares(PluginCall call) {
        JSObject result = new JSObject();
        result.put("shares", pending());
        call.resolve(result);
    }

    @PluginMethod
    public synchronized void acknowledgeShare(PluginCall call) {
        String eventId = call.getString("eventId");
        if (eventId == null) {
            call.reject("Missing share event ID");
            return;
        }
        JSONArray queue = pending();
        JSONArray remaining = new JSONArray();
        for (int i = 0; i < queue.length(); i++) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && !eventId.equals(item.optString("eventId"))) remaining.put(item);
        }
        save(remaining);
        call.resolve();
    }
}
