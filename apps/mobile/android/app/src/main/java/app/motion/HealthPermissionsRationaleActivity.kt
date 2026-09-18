package app.motion

import android.os.Bundle
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class HealthPermissionsRationaleActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val density = resources.displayMetrics.density
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((24*density).toInt(), (48*density).toInt(), (24*density).toInt(), (24*density).toInt())
            addView(TextView(context).apply { text = "Motion 使用 Health Connect"; textSize = 24f })
            addView(TextView(context).apply {
                text = "Motion 读取你授权的身体、活动和恢复数据，用于身体趋势与每日健康摘要。数据保存在 Motion 本地，Motion 不会向 Health Connect 写入数据。拒绝授权不影响手动记录。"
                textSize = 16f
                setPadding(0, (20*density).toInt(), 0, 0)
            })
        }
        setContentView(layout)
    }
}
