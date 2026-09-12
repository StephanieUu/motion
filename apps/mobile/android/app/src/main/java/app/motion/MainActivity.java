package app.motion;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MotionSharePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
