package app.motion

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions

@CapacitorPlugin(name = "MotionBodyOcr")
class MotionBodyOcrPlugin : Plugin() {
    private data class Region(val top: Int, val bottom: Int)
    private data class RecognizedLine(val top: Int, val left: Int, val text: String)

    @PluginMethod
    fun chooseAndRecognize(call: PluginCall) {
        val intent = if (Build.VERSION.SDK_INT >= 33) Intent(MediaStore.ACTION_PICK_IMAGES)
            else Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
        intent.type = "image/*"
        startActivityForResult(call, intent, "photoPicked")
    }

    @ActivityCallback
    private fun photoPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            call.reject("IMAGE_NOT_SELECTED")
            return
        }
        Thread {
            try {
                val bitmap = decodeOriginal(uri)
                val recognizer = TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
                if (isLongScreenshot(bitmap)) recognizeTiles(call, recognizer, bitmap)
                else recognizeWholeImage(call, recognizer, bitmap)
            } catch (_: Exception) {
                call.reject("IMAGE_READ_FAILED")
            }
        }.start()
    }

    /** Decode the selected media itself at its encoded dimensions. No thumbnail, sampling or recompression is used. */
    private fun decodeOriginal(uri: Uri): Bitmap {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val source = ImageDecoder.createSource(context.contentResolver, uri)
            return ImageDecoder.decodeBitmap(source) { decoder, _, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                decoder.isMutableRequired = false
            }
        }
        val options = BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.ARGB_8888
            inSampleSize = 1
            inScaled = false
        }
        return context.contentResolver.openInputStream(uri)?.use { stream ->
            BitmapFactory.decodeStream(stream, null, options)
        } ?: throw IllegalArgumentException("IMAGE_READ_FAILED")
    }

    private fun isLongScreenshot(bitmap: Bitmap): Boolean =
        bitmap.height > 3_000 && bitmap.height > bitmap.width * 2

    private fun recognizeWholeImage(call: PluginCall, recognizer: TextRecognizer, bitmap: Bitmap) {
        recognizer.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener { result -> finish(call, recognizer, bitmap, result.text) }
            .addOnFailureListener { fail(call, recognizer, bitmap) }
    }

    private fun recognizeTiles(call: PluginCall, recognizer: TextRecognizer, bitmap: Bitmap) {
        val tileHeight = 2_200.coerceAtMost(bitmap.height)
        val overlap = 240.coerceAtMost(tileHeight / 4)
        val regions = mutableListOf<Region>()
        var top = 0
        while (top < bitmap.height) {
            val bottom = (top + tileHeight).coerceAtMost(bitmap.height)
            regions += Region(top, bottom)
            if (bottom == bitmap.height) break
            top = bottom - overlap
        }

        val lines = mutableListOf<RecognizedLine>()
        fun process(index: Int) {
            if (index == regions.size) {
                val merged = mergeLines(lines)
                finish(call, recognizer, bitmap, merged)
                return
            }
            val region = regions[index]
            val tile = Bitmap.createBitmap(bitmap, 0, region.top, bitmap.width, region.bottom - region.top)
            recognizer.process(InputImage.fromBitmap(tile, 0))
                .addOnSuccessListener { result ->
                    addLines(lines, region.top, result)
                    tile.recycle()
                    process(index + 1)
                }
                .addOnFailureListener {
                    tile.recycle()
                    fail(call, recognizer, bitmap)
                }
        }
        process(0)
    }

    private fun addLines(target: MutableList<RecognizedLine>, tileTop: Int, result: Text) {
        result.textBlocks.flatMap { it.lines }.forEach { line ->
            val box = line.boundingBox
            val value = line.text.trim()
            if (value.isNotEmpty()) target += RecognizedLine(
                tileTop + (box?.top ?: 0), box?.left ?: 0, value,
            )
        }
    }

    /** Rebuild visual rows before parsing so multi-column report tables retain label/value order. */
    private fun mergeLines(input: List<RecognizedLine>): String {
        val unique = mutableListOf<RecognizedLine>()
        input.sortedWith(compareBy<RecognizedLine> { it.top }.thenBy { it.left }).forEach { line ->
            val key = line.text.replace(Regex("\\s+"), "")
            val duplicate = unique.any { existing ->
                existing.text.replace(Regex("\\s+"), "") == key &&
                    kotlin.math.abs(existing.top - line.top) <= 48 &&
                    kotlin.math.abs(existing.left - line.left) <= 48
            }
            if (!duplicate) unique += line
        }

        val rows = mutableListOf<MutableList<RecognizedLine>>()
        unique.sortedBy { it.top }.forEach { line ->
            val row = rows.lastOrNull()
            val rowTop = row?.map { it.top }?.average()
            if (row == null || rowTop == null || kotlin.math.abs(line.top - rowTop) > 28) {
                rows += mutableListOf(line)
            } else {
                row += line
            }
        }
        return rows.joinToString("\n") { row ->
            row.sortedBy { it.left }.joinToString(" ") { it.text }
        }
    }

    private fun finish(call: PluginCall, recognizer: TextRecognizer, bitmap: Bitmap, text: String) {
        call.resolve(JSObject().put("text", text))
        recognizer.close()
        bitmap.recycle()
    }

    private fun fail(call: PluginCall, recognizer: TextRecognizer, bitmap: Bitmap) {
        call.reject("OCR_FAILED")
        recognizer.close()
        bitmap.recycle()
    }
}
