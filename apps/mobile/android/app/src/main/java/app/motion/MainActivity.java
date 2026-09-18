package app.motion;

import com.getcapacitor.BridgeActivity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Build;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MotionSharePlugin.class);
        registerPlugin(MotionHealthConnectPlugin.class);
        registerPlugin(MotionBodyOcrPlugin.class);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }

        WindowInsetsControllerCompat systemBars = WindowCompat.getInsetsController(
            getWindow(), getWindow().getDecorView()
        );
        systemBars.setAppearanceLightStatusBars(true);
        systemBars.setAppearanceLightNavigationBars(true);
        configureEdgeToEdgeInsets();
    }

    private void configureEdgeToEdgeInsets() {
        View webViewContainer = (View) getBridge().getWebView().getParent();
        ViewCompat.setOnApplyWindowInsetsListener(webViewContainer, (view, windowInsets) -> {
            Insets safeArea = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            boolean keyboardVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime());
            view.setPadding(0, 0, 0, keyboardVisible ? ime.bottom : 0);

            float density = getResources().getDisplayMetrics().density;
            String script = String.format(
                Locale.US,
                "document.documentElement.style.setProperty('--safe-area-inset-top','%dpx');" +
                "document.documentElement.style.setProperty('--safe-area-inset-right','%dpx');" +
                "document.documentElement.style.setProperty('--safe-area-inset-bottom','%dpx');" +
                "document.documentElement.style.setProperty('--safe-area-inset-left','%dpx');",
                Math.round(safeArea.top / density),
                Math.round(safeArea.right / density),
                keyboardVisible ? 0 : Math.round(safeArea.bottom / density),
                Math.round(safeArea.left / density)
            );
            getBridge().getWebView().evaluateJavascript(script, null);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webViewContainer);
    }
}
