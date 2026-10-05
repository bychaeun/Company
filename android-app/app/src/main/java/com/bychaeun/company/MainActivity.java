package com.bychaeun.company;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;

public final class MainActivity extends Activity {
    private static final Uri APP_URI = Uri.parse("https://bychaeun.github.io/Company/");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openApp();
    }

    private void openApp() {
        Intent intent = new Intent(Intent.ACTION_VIEW, APP_URI);
        Bundle customTab = new Bundle();
        customTab.putBinder("android.support.customtabs.extra.SESSION", null);
        intent.putExtras(customTab);
        intent.putExtra("android.support.customtabs.extra.TOOLBAR_COLOR", Color.rgb(255, 241, 247));
        intent.putExtra("android.support.customtabs.extra.ENABLE_URLBAR_HIDING", true);
        intent.putExtra("android.support.customtabs.extra.SHARE_MENU_ITEM", false);

        try {
            startActivity(intent);
        } catch (ActivityNotFoundException error) {
            startActivity(new Intent(Intent.ACTION_VIEW, APP_URI));
        }
        finish();
    }
}
