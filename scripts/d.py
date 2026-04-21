import arcpy
arcpy.env.workspace = r"D:\websites\WebMap589\AmphibianMap.gdb"
print(arcpy.Exists(r"D:\websites\WebMap589\AmphibianMap.gdb"))
print(arcpy.ListFeatureClasses())
