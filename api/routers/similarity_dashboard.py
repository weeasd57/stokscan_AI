"""
Historical Similarity Dashboard - Display all results and analytics
"""
from fastapi import APIRouter, HTTPException, Query
from typing import List, Dict, Any, Optional
import json
from api.historical_similarity import (
    get_published_similarity_report,
    get_similarity_cases,
    run_historical_similarity
)

router = APIRouter(prefix="/api/similarity", tags=["similarity"])


@router.get("/dashboard/summary")
async def get_dashboard_summary():
    """Get complete dashboard summary with all results"""
    try:
        # Get published report
        report = get_published_similarity_report()
        
        if not report or not report.get("id"):
            return {
                "status": "no_data",
                "message": "لا توجد تقارير منشورة",
                "report": None,
                "cases": [],
                "summary": {
                    "total_scans": 0,
                    "total_matches": 0,
                    "overall_win_rate": 0,
                    "overall_avg_return": 0
                }
            }
        
        # Parse scans
        scans = report.get('scans', [])
        if isinstance(scans, str):
            scans = json.loads(scans)
        
        # Get all cases
        cases = get_similarity_cases()
        
        # Calculate aggregated statistics
        total_matches = 0
        total_wins = 0
        total_closed = 0
        all_returns = []
        
        for scan in scans:
            stats = scan.get('stats', {})
            matches = scan.get('matches', [])
            
            total_matches += len(matches)
            total_wins += stats.get('wins', 0)
            total_closed += stats.get('total_matches', 0)
            
            if stats.get('average_return'):
                all_returns.append(stats.get('average_return'))
        
        overall_win_rate = (total_wins / total_closed * 100) if total_closed > 0 else 0
        overall_avg_return = sum(all_returns) / len(all_returns) if all_returns else 0
        
        return {
            "status": "success",
            "report": {
                "id": report.get('id'),
                "name": report.get('name'),
                "updated_at": report.get('updated_at'),
                "k": report.get('k'),
                "forward_days": report.get('forward_days'),
                "target_return": report.get('target_return'),
                "stop_loss": report.get('stop_loss')
            },
            "scans": scans,
            "cases": cases,
            "summary": {
                "total_scans": len(scans),
                "total_matches": total_matches,
                "overall_win_rate": round(overall_win_rate, 2),
                "overall_avg_return": round(overall_avg_return, 4),
                "total_wins": total_wins,
                "total_closed": total_closed,
                "saved_cases": len(cases)
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ في جلب البيانات: {str(e)}")


@router.get("/dashboard/scans")
async def get_all_scans(
    limit: Optional[int] = Query(None, description="عدد النتائج المطلوب عرضها"),
    sort_by: Optional[str] = Query("win_rate", description="ترتيب النتائج: win_rate, avg_return, matches")
):
    """Get all published scans with detailed breakdown"""
    try:
        report = get_published_similarity_report()
        
        if not report or not report.get("id"):
            return {"scans": [], "total": 0}
        
        scans = report.get('scans', [])
        if isinstance(scans, str):
            scans = json.loads(scans)
        
        # Format scans for display
        formatted_scans = []
        for scan in scans:
            scan_data = {
                "symbol": scan.get('symbol'),
                "target_date": scan.get('target_date'),
                "target_values": scan.get('target_values'),
                "target_path": scan.get('target_path'),
                "matches": scan.get('matches', []),
                "stats": scan.get('stats', {})
            }
            formatted_scans.append(scan_data)
        
        # Sort
        if sort_by == "win_rate":
            formatted_scans.sort(key=lambda x: x['stats'].get('win_rate', 0), reverse=True)
        elif sort_by == "avg_return":
            formatted_scans.sort(key=lambda x: x['stats'].get('average_return', 0), reverse=True)
        elif sort_by == "matches":
            formatted_scans.sort(key=lambda x: len(x.get('matches', [])), reverse=True)
        
        # Limit
        if limit:
            formatted_scans = formatted_scans[:limit]
        
        return {
            "total": len(formatted_scans),
            "scans": formatted_scans
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")


@router.get("/dashboard/scans/{symbol}")
async def get_scan_details(symbol: str):
    """Get detailed information about a specific scan"""
    try:
        report = get_published_similarity_report()
        
        if not report or not report.get("id"):
            raise HTTPException(status_code=404, detail="لا توجد تقارير")
        
        scans = report.get('scans', [])
        if isinstance(scans, str):
            scans = json.loads(scans)
        
        # Find scan
        for scan in scans:
            if scan.get('symbol') == symbol:
                return {
                    "symbol": symbol,
                    "target_date": scan.get('target_date'),
                    "target_values": scan.get('target_values'),
                    "target_path": scan.get('target_path'),
                    "matches": scan.get('matches', []),
                    "stats": scan.get('stats', {}),
                    "total_matches": len(scan.get('matches', [])),
                    "report_id": report.get('id'),
                    "report_name": report.get('name')
                }
        
        raise HTTPException(status_code=404, detail=f"لم يتم العثور على {symbol}")
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")


@router.get("/dashboard/matches/{symbol}")
async def get_match_details(
    symbol: str,
    limit: Optional[int] = Query(None, description="عدد المطابقات المطلوب عرضها")
):
    """Get detailed information about historical matches for a symbol"""
    try:
        report = get_published_similarity_report()
        
        if not report or not report.get("id"):
            raise HTTPException(status_code=404, detail="لا توجد تقارير")
        
        scans = report.get('scans', [])
        if isinstance(scans, str):
            scans = json.loads(scans)
        
        # Find scan
        for scan in scans:
            if scan.get('symbol') == symbol:
                matches = scan.get('matches', [])
                
                if limit:
                    matches = matches[:limit]
                
                # Format matches
                formatted_matches = []
                for i, match in enumerate(matches):
                    formatted_matches.append({
                        "rank": i + 1,
                        "date": match.get('date'),
                        "symbol": match.get('symbol'),
                        "similarity_score": round(match.get('similarity', 0), 4),
                        "entry_price": match.get('entry_price'),
                        "outcome": match.get('outcome'),  # win/loss
                        "final_return": round(match.get('final_return', 0), 4),
                        "mfe": round(match.get('mfe', 0), 4),  # Max Favorable Excursion
                        "mae": round(match.get('mae', 0), 4),  # Max Adverse Excursion
                        "exit_date": match.get('exit_date'),
                        "exit_day_index": match.get('exit_day_index'),
                        "before_path": match.get('before_path', []),
                        "forward_path": match.get('forward_path', [])
                    })
                
                return {
                    "symbol": symbol,
                    "target_date": scan.get('target_date'),
                    "total_matches": len(scan.get('matches', [])),
                    "matches_shown": len(formatted_matches),
                    "matches": formatted_matches,
                    "stats": scan.get('stats', {})
                }
        
        raise HTTPException(status_code=404, detail=f"لم يتم العثور على {symbol}")
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")


@router.get("/dashboard/statistics")
async def get_statistics():
    """Get comprehensive statistics across all scans"""
    try:
        report = get_published_similarity_report()
        
        if not report or not report.get("id"):
            return {
                "report": None,
                "statistics": {
                    "total_scans": 0,
                    "total_matches": 0,
                    "average_matches_per_scan": 0,
                    "win_rate": 0,
                    "loss_rate": 0,
                    "average_return": 0,
                    "best_return": 0,
                    "worst_return": 0,
                    "symbols": []
                }
            }
        
        scans = report.get('scans', [])
        if isinstance(scans, str):
            scans = json.loads(scans)
        
        # Calculate statistics
        total_matches = 0
        all_wins = 0
        all_losses = 0
        all_returns = []
        symbols_stats = []
        best_return = None
        worst_return = None
        
        for scan in scans:
            symbol = scan.get('symbol')
            matches = scan.get('matches', [])
            stats = scan.get('stats', {})
            
            total_matches += len(matches)
            all_wins += stats.get('wins', 0)
            all_losses += stats.get('losses', 0)
            
            for match in matches:
                ret = match.get('final_return', 0)
                all_returns.append(ret)
                
                if best_return is None or ret > best_return:
                    best_return = ret
                if worst_return is None or ret < worst_return:
                    worst_return = ret
            
            symbols_stats.append({
                "symbol": symbol,
                "matches": len(matches),
                "win_rate": round(stats.get('win_rate', 0) * 100, 2),
                "average_return": round(stats.get('average_return', 0), 4),
                "wins": stats.get('wins', 0),
                "losses": stats.get('losses', 0),
                "profit_factor": round(stats.get('profit_factor', 0), 4)
            })
        
        total_closed = all_wins + all_losses
        
        return {
            "report": {
                "id": report.get('id'),
                "name": report.get('name'),
                "updated_at": report.get('updated_at')
            },
            "statistics": {
                "total_scans": len(scans),
                "total_matches": total_matches,
                "average_matches_per_scan": round(total_matches / len(scans), 2) if scans else 0,
                "win_rate": round((all_wins / total_closed * 100), 2) if total_closed > 0 else 0,
                "loss_rate": round((all_losses / total_closed * 100), 2) if total_closed > 0 else 0,
                "wins": all_wins,
                "losses": all_losses,
                "average_return": round(sum(all_returns) / len(all_returns), 4) if all_returns else 0,
                "best_return": round(best_return, 4) if best_return is not None else 0,
                "worst_return": round(worst_return, 4) if worst_return is not None else 0,
                "symbols": symbols_stats
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")


@router.get("/dashboard/export")
async def export_all_results(format: str = Query("json", description="json أو csv")):
    """Export all results in JSON or CSV format"""
    try:
        report = get_published_similarity_report()
        
        if not report or not report.get("id"):
            raise HTTPException(status_code=404, detail="لا توجد بيانات للتصدير")
        
        scans = report.get('scans', [])
        if isinstance(scans, str):
            scans = json.loads(scans)
        
        if format.lower() == "json":
            return {
                "report": report,
                "scans": scans,
                "export_format": "json"
            }
        
        elif format.lower() == "csv":
            import csv
            import io
            
            csv_buffer = io.StringIO()
            writer = csv.writer(csv_buffer)
            
            # Header
            writer.writerow([
                "Symbol", "Target Date", "Win Rate %", "Avg Return %", 
                "Total Matches", "Wins", "Losses", "Profit Factor"
            ])
            
            # Data rows
            for scan in scans:
                stats = scan.get('stats', {})
                writer.writerow([
                    scan.get('symbol'),
                    scan.get('target_date'),
                    round(stats.get('win_rate', 0) * 100, 2),
                    round(stats.get('average_return', 0), 4),
                    stats.get('total_matches', 0),
                    stats.get('wins', 0),
                    stats.get('losses', 0),
                    round(stats.get('profit_factor', 0), 4)
                ])
            
            return {
                "csv_data": csv_buffer.getvalue(),
                "export_format": "csv"
            }
        
        else:
            raise HTTPException(status_code=400, detail="صيغة غير مدعومة: استخدم json أو csv")
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"خطأ: {str(e)}")
