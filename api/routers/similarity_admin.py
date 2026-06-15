"""
Historical Similarity Admin Tab - Full market scan and display
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks, Header, Depends, Query
from typing import List, Dict, Any, Optional
import json
import threading
from datetime import datetime
from api.historical_similarity import (
    run_market_wide_similarity_scan,
    get_published_similarity_report,
    publish_similarity_report,
    get_similarity_cases,
    save_similarity_case
)
import os

router = APIRouter(prefix="/api/admin/similarity", tags=["admin-similarity"])


def _verify_admin_key(x_admin_key: Optional[str] = Header(default=None)):
    """Verify admin access"""
    secret = os.getenv("ADMIN_SECRET_KEY", "").strip()
    if not secret:
        return  # Not configured — allow all (legacy mode)
    if x_admin_key != secret:
        raise HTTPException(status_code=403, detail="Forbidden: invalid admin key")


# Store for tracking scan progress — job-based to prevent race conditions
_scan_lock = threading.Lock()
_current_job_id: Optional[str] = None
_current_scan_progress: Dict[str, Any] = {
    "status": "idle",
    "percentage": 0,
    "found": 0,
    "total": 0,
    "message": ""
}


def _set_scan_progress(patch: Dict[str, Any]) -> None:
    global _current_scan_progress
    with _scan_lock:
        _current_scan_progress.update(patch)


def _get_scan_progress() -> Dict[str, Any]:
    with _scan_lock:
        return dict(_current_scan_progress)


def _acquire_scan_lock(job_id: str) -> bool:
    global _current_job_id
    with _scan_lock:
        if _current_job_id is not None:
            return False
        _current_job_id = job_id
        _current_scan_progress = {"status": "starting", "percentage": 0, "found": 0, "total": 0, "message": "جاري بدء المسح..."}
        return True


def _release_scan_lock(job_id: str) -> None:
    global _current_job_id
    with _scan_lock:
        if _current_job_id == job_id:
            _current_job_id = None
            _current_scan_progress = {"status": "idle", "percentage": 0, "found": 0, "total": 0, "message": ""}


@router.get("/scan-all")
async def get_all_scans(admin_key: Optional[str] = Header(default=None)):
    """
    Get the latest full market scan (without running a new one)
    Returns all symbols that were previously scanned
    """
    try:
        _verify_admin_key(admin_key)
        
        report = get_published_similarity_report()
        
        if not report or not report.get("id"):
            return {
                "status": "no_data",
                "message": "لا توجد عمليات مسح منشورة",
                "scans": [],
                "summary": {
                    "total": 0,
                    "top_win_rate": 0,
                    "avg_win_rate": 0
                }
            }
        
        scans = report.get('scans', [])
        if isinstance(scans, str):
            scans = json.loads(scans)
        
        # Calculate summary
        win_rates = [s.get('stats', {}).get('win_rate', 0) for s in scans]
        
        return {
            "status": "success",
            "report_id": report.get('id'),
            "report_name": report.get('name'),
            "updated_at": report.get('updated_at'),
            "scans": scans,
            "summary": {
                "total": len(scans),
                "top_win_rate": max(win_rates, default=0) * 100,
                "avg_win_rate": (sum(win_rates) / len(win_rates) * 100) if win_rates else 0,
                "k": report.get('k', 10),
                "forward_days": report.get('forward_days', 10)
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")


@router.post("/run-full-market-scan")
async def run_full_market_scan(
    k: int = Query(10, description="عدد المطابقات التاريخية"),
    forward_days: int = Query(10, description="عدد أيام المتابعة"),
    target_return: float = Query(0.05, description="العائد المستهدف"),
    stop_loss: float = Query(-0.03, description="وقف الخسارة"),
    search_scope: str = Query("same_symbol", description="same_symbol أو all_symbols"),
    background_tasks: BackgroundTasks = None,
    admin_key: Optional[str] = Header(default=None)
):
    """
    Run a full market-wide similarity scan on ALL symbols
    Supports same_symbol and cross-symbol (all_symbols) search scope.
    """
    try:
        _verify_admin_key(admin_key)
        import uuid
        job_id = str(uuid.uuid4())

        if not _acquire_scan_lock(job_id):
            raise HTTPException(status_code=409, detail="هناك مسح قيد التنفيذ بالفعل.")

        print(f"🚀 Starting full market similarity scan (job={job_id})...")
        print(f"   Parameters: K={k}, Forward Days={forward_days}, Target={target_return}, SL={stop_loss}, Scope={search_scope}")

        def progress_callback(progress_data):
            _set_scan_progress({
                **progress_data,
                "message": f"جاري المسح: {progress_data['completed']}/{progress_data['total']}"
            })
            print(f"   {_current_scan_progress['message']}")

        try:
            results = run_market_wide_similarity_scan(
                k=k,
                forward_days=forward_days,
                target_return=target_return,
                stop_loss=stop_loss,
                search_scope=search_scope,
                progress_callback=progress_callback
            )

            print(f"✅ Scan completed! Found {len(results)} results")

            if results:
                report_data = {
                    "name": f"Full Market Scan - {datetime.now().strftime('%Y-%m-%d %H:%M')}",
                    "scans": results,
                    "k": k,
                    "forward_days": forward_days,
                    "target_return": target_return,
                    "stop_loss": stop_loss
                }

                published_report = publish_similarity_report(report_data)
                print(f"✅ Report published: {published_report.get('id')}")
                _set_scan_progress({"status": "success", "percentage": 100, "message": f"تم بنجاح - {len(results)} نتيجة"})

                return {
                    "status": "success",
                    "message": f"تم مسح السوق بنجاح - وجدنا {len(results)} نتيجة",
                    "report_id": published_report.get('id'),
                    "results_count": len(results),
                    "scans": results[:50]
                }
            else:
                _set_scan_progress({"status": "success", "percentage": 100, "message": "لا توجد نتائج"})
                return {
                    "status": "success",
                    "message": "تم المسح لكن لم يتم العثور على نتائج",
                    "results_count": 0,
                    "scans": []
                }
        finally:
            _release_scan_lock(job_id)

    except HTTPException:
        raise
    except Exception as e:
        _release_scan_lock(job_id if 'job_id' in dir() else "")
        print(f"❌ Error during scan: {str(e)}")
        raise HTTPException(status_code=500, detail=f"خطأ أثناء المسح: {str(e)}")


@router.get("/scan-progress")
async def get_scan_progress(admin_key: Optional[str] = Header(default=None)):
    """Get current scan progress"""
    try:
        _verify_admin_key(admin_key)
        return _get_scan_progress()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")


@router.get("/historical-results")
async def get_historical_results(
    sort_by: str = Query("win_rate", description="ترتيب: win_rate, returns, matches"),
    limit: Optional[int] = Query(None, description="حد أقصى للنتائج"),
    min_win_rate: Optional[float] = Query(None, description="أدنى معدل نجاح"),
    admin_key: Optional[str] = Header(default=None)
):
    """
    Get historical scan results with filtering and sorting
    This tab shows ALL previous scans for comparison
    """
    try:
        _verify_admin_key(admin_key)
        
        report = get_published_similarity_report()
        
        if not report or not report.get("id"):
            return {
                "status": "no_data",
                "results": [],
                "total": 0
            }
        
        scans = report.get('scans', [])
        if isinstance(scans, str):
            scans = json.loads(scans)
        
        # Filter by minimum win rate
        if min_win_rate is not None:
            scans = [s for s in scans if s.get('stats', {}).get('win_rate', 0) >= min_win_rate]
        
        # Sort
        if sort_by == "win_rate":
            scans.sort(key=lambda x: x['stats'].get('win_rate', 0), reverse=True)
        elif sort_by == "returns":
            scans.sort(key=lambda x: x['stats'].get('average_return', 0), reverse=True)
        elif sort_by == "matches":
            scans.sort(key=lambda x: len(x.get('matches', [])), reverse=True)
        
        # Limit results
        if limit:
            scans = scans[:limit]
        
        # Format for display
        formatted_results = []
        for i, scan in enumerate(scans):
            stats = scan.get('stats', {})
            formatted_results.append({
                "rank": i + 1,
                "symbol": scan.get('symbol'),
                "target_date": scan.get('target_date'),
                "win_rate": round(stats.get('win_rate', 0) * 100, 1),
                "average_return": round(stats.get('average_return', 0), 4),
                "total_matches": stats.get('total_matches', 0),
                "wins": stats.get('wins', 0),
                "losses": stats.get('losses', 0),
                "profit_factor": round(stats.get('profit_factor', 0), 4),
                "best_match": {
                    "similarity": round(max([m.get('similarity', 0) for m in scan.get('matches', [])], default=0), 4),
                    "return": round(max([m.get('final_return', 0) for m in scan.get('matches', [])], default=0), 4)
                } if scan.get('matches') else None
            })
        
        return {
            "status": "success",
            "report_id": report.get('id'),
            "report_date": report.get('updated_at'),
            "total_results": len(formatted_results),
            "results": formatted_results
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")


@router.get("/compare-scans")
async def compare_scans(
    symbol1: str = Query(..., description="السهم الأول للمقارنة"),
    symbol2: Optional[str] = Query(None, description="السهم الثاني للمقارنة"),
    admin_key: Optional[str] = Header(default=None)
):
    """
    Compare two scans side-by-side
    Shows all their matches and statistics
    """
    try:
        _verify_admin_key(admin_key)
        
        report = get_published_similarity_report()
        
        if not report or not report.get("id"):
            raise HTTPException(status_code=404, detail="لا توجد بيانات")
        
        scans = report.get('scans', [])
        if isinstance(scans, str):
            scans = json.loads(scans)
        
        # Find scans
        scan1 = None
        scan2 = None
        
        for scan in scans:
            if scan.get('symbol') == symbol1:
                scan1 = scan
            if symbol2 and scan.get('symbol') == symbol2:
                scan2 = scan
        
        if not scan1:
            raise HTTPException(status_code=404, detail=f"لم يتم العثور على {symbol1}")
        
        comparison = {
            "symbol1": {
                "symbol": symbol1,
                "target_date": scan1.get('target_date'),
                "target_price": scan1.get('target_values', {}).get('close'),
                "stats": scan1.get('stats'),
                "matches_count": len(scan1.get('matches', []))
            }
        }
        
        if scan2:
            comparison["symbol2"] = {
                "symbol": symbol2,
                "target_date": scan2.get('target_date'),
                "target_price": scan2.get('target_values', {}).get('close'),
                "stats": scan2.get('stats'),
                "matches_count": len(scan2.get('matches', []))
            }
            
            # Calculate difference
            wr1 = scan1.get('stats', {}).get('win_rate', 0)
            wr2 = scan2.get('stats', {}).get('win_rate', 0)
            ar1 = scan1.get('stats', {}).get('average_return', 0)
            ar2 = scan2.get('stats', {}).get('average_return', 0)
            
            comparison["difference"] = {
                "win_rate_diff": round((wr2 - wr1) * 100, 1),
                "avg_return_diff": round(ar2 - ar1, 4),
                "better_symbol": symbol2 if wr2 > wr1 else symbol1
            }
        
        return {
            "status": "success",
            "comparison": comparison
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
